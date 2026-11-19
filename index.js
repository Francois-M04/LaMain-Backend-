const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const { router: authRouter, setPool, authMiddleware, requireRole } = require('./auth');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

pool.connect((err, client, release) => {
    if (err) {
        return console.error('Erreur de connexion à PostgreSQL :', err.stack);
    }
    console.log('✅ Connexion à PostgreSQL réussie !');
    release();
});

// ✅ Configuration Nodemailer
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

transporter.verify((error, success) => {
    if (error) {
        console.warn('SMTP non disponible (emails désactivés) :', error.message);
    } else {
        console.log('Serveur SMTP prêt à envoyer des emails');
    }
});

// ✅ Route publique (utilisée par le front pour détecter l'API)
app.get('/test-db', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');
        res.json({ message: "Connexion réussie à PostgreSQL !", date_serveur: result.rows[0].now });
    } catch (err) {
        res.status(500).json({ error: "Erreur de connexion à la BDD" });
    }
});

// ✅ AUTH (publique)
setPool(pool);
app.use('/api/auth', authRouter);

// 🔒 À partir d'ici, toutes les routes /api/* exigent un JWT valide
app.use('/api', authMiddleware);

// --- 1. ROUTES ÉQUIPEMENTS ---
app.get('/api/equipements', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM Equipement ORDER BY id_equipement');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/equipements', async (req, res) => {
    try {
        const { nom_equipement, categorie, localisation, etat, id_inst } = req.body;
        const result = await pool.query(
            'INSERT INTO Equipement (nom_equipement, categorie, localisation, etat, id_inst) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [nom_equipement, categorie, localisation, etat, id_inst || req.user.id_inst || 1]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/equipements/:id', requireRole('Admin'), async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM Equipement WHERE id_equipement = $1', [id]);
        res.json({ message: "Équipement supprimé avec succès !" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 2. ROUTES RESPONSABLES ---
app.get('/api/responsables', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id_responsable, nom_responsable, numero, email, role FROM Responsable ORDER BY id_responsable'
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/responsables', requireRole('Admin'), async (req, res) => {
    try {
        const { nom_responsable, numero, email, mot_de_passe, role, id_inst } = req.body;

        if (!nom_responsable || !email || !mot_de_passe) {
            return res.status(400).json({ error: 'Nom, email et mot de passe requis.' });
        }

        const hash = await bcrypt.hash(mot_de_passe, 10);

        const result = await pool.query(
            `INSERT INTO Responsable (nom_responsable, numero, email, mot_de_passe, role, id_inst)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id_responsable, nom_responsable, email, role, numero, id_inst`,
            [nom_responsable, numero || null, email, hash, role || 'Responsable', id_inst || req.user.id_inst || 1]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
        }
        console.error(err);
        res.status(500).json({ error: "Erreur lors de l'ajout du responsable" });
    }
});

app.delete('/api/responsables/:id', requireRole('Admin'), async (req, res) => {
    try {
        const { id } = req.params;
        // Empêcher un admin de se supprimer lui-même
        if (parseInt(id) === req.user.id_responsable) {
            return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
        }
        await pool.query('DELETE FROM Responsable WHERE id_responsable = $1', [id]);
        res.json({ message: "Responsable supprimé avec succès !" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 3. ROUTES TÂCHES ---
app.get('/api/taches', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, e.nom_equipement, r.nom_responsable 
            FROM Tache t
            LEFT JOIN Equipement e ON t.id_equipement = e.id_equipement
            LEFT JOIN Responsable r ON t.id_responsable = r.id_responsable
            ORDER BY t.date_echeance ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/taches', async (req, res) => {
    try {
        const { titre_tache, type_tache, description_tache, date_echeance, frequence, id_equipement, id_responsable } = req.body;
        
        const maintenant = new Date();
        const echeance = new Date(date_echeance);
        const statutInitial = (echeance <= maintenant) ? 'En cours' : 'En attente';

        const result = await pool.query(
            `INSERT INTO Tache (titre_tache, type_tache, description_tache, date_echeance, frequence, statut, id_equipement, id_responsable) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [titre_tache, type_tache, description_tache, date_echeance, frequence, statutInitial, id_equipement, id_responsable || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/taches/:id', requireRole('Admin'), async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM Tache WHERE id_tache = $1', [id]);
        res.json({ message: "Tâche supprimée avec succès !" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 4. ROUTES INTERVENTIONS ---
app.get('/api/interventions', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT i.*, r.nom_responsable, t.titre_tache 
            FROM Intervention i
            LEFT JOIN Responsable r ON i.id_responsable = r.id_responsable
            LEFT JOIN Tache t ON i.id_tache = t.id_tache
            ORDER BY i.date_realisation DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/interventions', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_tache, commentaire, cout_intervention, statut_resultat } = req.body;
        // ✅ Le responsable vient du token, plus du body
        const id_responsable = req.user.id_responsable;
        const dateRealisation = new Date();

        await client.query(
            `INSERT INTO Intervention (date_realisation, commentaire, cout_intervention, id_tache, id_responsable) 
             VALUES ($1, $2, $3, $4, $5)`,
            [dateRealisation, commentaire, cout_intervention || 0.00, id_tache, id_responsable]
        );

        const tacheRes = await client.query('SELECT * FROM Tache WHERE id_tache = $1', [id_tache]);
        const tache = tacheRes.rows[0];

        const respInfo = await client.query(
            'SELECT email, nom_responsable FROM Responsable WHERE id_responsable = $1',
            [tache.id_responsable || id_responsable]
        );
        const respData = respInfo.rows[0] || { email: null, nom_responsable: 'Responsable inconnu' };

        if (statut_resultat === 'Bloquée') {
            await client.query("UPDATE Tache SET statut = 'Bloquée' WHERE id_tache = $1", [id_tache]);
            await client.query("UPDATE Equipement SET etat = 'En attente de pièce' WHERE id_equipement = $1", [tache.id_equipement]);

            const msgBloquage = `Alerte : La tâche '${tache.titre_tache}' est bloquée. Motif : ${commentaire || 'Non précisé'}. Action requise.`;
            await client.query(
                `INSERT INTO Notification (message, id_tache, id_responsable) VALUES ($1, $2, $3)`,
                [msgBloquage, id_tache, tache.id_responsable || id_responsable]
            );

            const adminRes = await client.query(
                "SELECT id_responsable FROM Responsable WHERE role = 'Admin' LIMIT 1"
            );
            if (adminRes.rows.length > 0 && adminRes.rows[0].id_responsable !== tache.id_responsable) {
                const msgAdmin = `Alerte Admin : La tâche '${tache.titre_tache}' a été signalée bloquée par ${respData.nom_responsable}. Rupture/Problème : ${commentaire || 'Non précisé'}.`;
                await client.query(
                    `INSERT INTO Notification (message, id_tache, id_responsable) VALUES ($1, $2, $3)`,
                    [msgAdmin, id_tache, adminRes.rows[0].id_responsable]
                );
            }

        } else {
            await client.query("UPDATE Tache SET statut = 'Terminée' WHERE id_tache = $1", [id_tache]);
            await client.query("UPDATE Equipement SET etat = 'Fonctionnel' WHERE id_equipement = $1", [tache.id_equipement]);

            if (tache.frequence && tache.frequence !== 'Ponctuelle') {
                let nouvelleDate = new Date(dateRealisation);
                let freq = tache.frequence.toLowerCase();

                if (freq.includes('mensuelle')) nouvelleDate.setMonth(nouvelleDate.getMonth() + 1);
                else if (freq.includes('trimestrielle')) nouvelleDate.setMonth(nouvelleDate.getMonth() + 3);
                else if (freq.includes('semestrielle')) nouvelleDate.setMonth(nouvelleDate.getMonth() + 6);
                else if (freq.includes('annuelle')) nouvelleDate.setFullYear(nouvelleDate.getFullYear() + 1);
                else nouvelleDate.setDate(nouvelleDate.getDate() + 30);

                await client.query(
                    `INSERT INTO Tache (titre_tache, type_tache, description_tache, date_echeance, frequence, statut, id_equipement, id_responsable)
                     VALUES ($1, $2, $3, $4, $5, 'En attente', $6, $7)`,
                    [tache.titre_tache, tache.type_tache, tache.description_tache, nouvelleDate, tache.frequence, tache.id_equipement, tache.id_responsable]
                );
            }
        }

        await client.query('COMMIT');
        res.status(201).json({ message: "Intervention enregistrée avec succès !" });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// --- 5. ROUTES NOTIFICATIONS ---
app.get('/api/notifications', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT n.*, t.titre_tache, r.nom_responsable
            FROM Notification n
            LEFT JOIN Tache t ON n.id_tache = t.id_tache
            LEFT JOIN Responsable r ON n.id_responsable = r.id_responsable
            ORDER BY n.date_envoie DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/notifications', requireRole('Admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM Notification');
        res.json({ message: "Toutes les notifications ont été marquées comme lues." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 6. CRON JOB : RAPPELS EMAIL + PLATEFORME (tous les jours à 08:00) ---
// Pour tester rapidement, remplace par '* * * * *' (toutes les minutes)
cron.schedule('* * * * *', async () => {
    console.log('Vérification des échéances...');
    
    try {
        await pool.query(`
            UPDATE Tache 
            SET statut = 'En cours' 
            WHERE statut = 'En attente' 
            AND date_echeance <= NOW()
        `);

        const tachesEchues = await pool.query(`
            SELECT t.*, r.email AS responsable_email, r.nom_responsable, e.nom_equipement
            FROM Tache t
            JOIN Responsable r ON t.id_responsable = r.id_responsable
            LEFT JOIN Equipement e ON t.id_equipement = e.id_equipement
            WHERE t.date_echeance <= NOW() 
            AND t.statut NOT IN ('Bloquée', 'Terminée')
        `);

        console.log(`${tachesEchues.rows.length} tâche(s) à traiter.`);

        for (const tache of tachesEchues.rows) {
            const derniereNotif = await pool.query(`
                SELECT date_envoie FROM Notification 
                WHERE id_tache = $1 
                ORDER BY date_envoie DESC LIMIT 1
            `, [tache.id_tache]);

            let envoyerRappel = true;
            if (derniereNotif.rows.length > 0) {
                const derniereDate = new Date(derniereNotif.rows[0].date_envoie);
                const diffHeures = (new Date() - derniereDate) / (1000 * 60 * 60);
                if (diffHeures < 24) envoyerRappel = false;
            }

            if (!envoyerRappel) continue;

            const equipementNom = tache.nom_equipement || 'Équipement';
            const dateEcheanceStr = new Date(tache.date_echeance).toLocaleString('fr-FR');

            const messageRappel = `Rappel : La tâche "${tache.titre_tache}" (Équipement : ${equipementNom}) arrive à échéance le ${dateEcheanceStr}. Assignée à ${tache.nom_responsable}. Veuillez procéder à l'intervention et mettre à jour son statut.`;

            // ✅ URL de la plateforme (configurable via .env)
            const plateformeUrl = process.env.FRONTEND_URL || 'http://localhost:5000';

            if (tache.responsable_email) {
                try {
                    await transporter.sendMail({
                        from: `"La Main - Gestion Préventive" <${process.env.EMAIL_USER}>`,
                        to: tache.responsable_email,
                        subject: `[Rappel La Main] Tâche urgente : ${tache.titre_tache}`,
                        html: `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rappel de Maintenance - LA MAIN</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 15px;">
    <tr>
      <td align="center">
        <!-- Container Principal -->
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); border: 1px solid #e2e8f0;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%); padding: 32px 36px; text-align: left;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <!-- Logo / Badge -->
                    <table role="presentation" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="background: linear-gradient(135deg, #2563eb, #10b981); width: 44px; height: 44px; border-radius: 12px; text-align: center; vertical-align: middle;">
                          <span style="color: #ffffff; font-size: 22px; font-weight: bold; line-height: 44px;">🛡️</span>
                        </td>
                        <td style="padding-left: 14px;">
                          <span style="font-size: 20px; font-weight: 800; letter-spacing: -0.5px; color: #ffffff; display: block;">LA MAIN</span>
                          <span style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #93c5fd; display: block; margin-top: 2px;">Système de Gestion Préventive — ISTEAH</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" style="vertical-align: top;">
                    <span style="display: inline-block; padding: 6px 12px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-radius: 9999px;">
                      ⚡ Échéance Due
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Contenu Principal -->
          <tr>
            <td style="padding: 36px 36px 24px 36px;">
              <h1 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #0f172a; line-height: 1.3;">
                Bonjour ${tache.nom_responsable},
              </h1>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #475569;">
                Une tâche de maintenance préventive sous votre responsabilité requiert une intervention sur site. Veuillez consulter les spécifications ci-dessous et procéder à sa réalisation.
              </p>

              <!-- Carte Récapitulative Tâche -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border-radius: 14px; border: 1px solid #e2e8f0; overflow: hidden; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 16px 20px; border-bottom: 1px solid #edf2f7; background-color: #f1f5f9;">
                    <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b;">Fiche de Travail Assignée</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 18px 20px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="padding-bottom: 12px; width: 35%; font-size: 13px; font-weight: 600; color: #64748b;">Tâche à exécuter</td>
                        <td style="padding-bottom: 12px; font-size: 14px; font-weight: 700; color: #0f172a;">${tache.titre_tache}</td>
                      </tr>
                      <tr>
                        <td style="padding-bottom: 12px; font-size: 13px; font-weight: 600; color: #64748b;">Équipement concerné</td>
                        <td style="padding-bottom: 12px; font-size: 14px; font-weight: 600; color: #2563eb;">
                          ⚙️ ${equipementNom}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding-bottom: 12px; font-size: 13px; font-weight: 600; color: #64748b;">Date d'échéance</td>
                        <td style="padding-bottom: 12px; font-size: 13px; font-weight: 700; color: #dc2626;">
                          📅 ${dateEcheanceStr}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding-bottom: 12px; font-size: 13px; font-weight: 600; color: #64748b;">Fréquence</td>
                        <td style="padding-bottom: 12px; font-size: 13px; color: #334155;">
                          🔄 ${tache.frequence || 'Ponctuelle'}
                        </td>
                      </tr>
                      <tr>
                        <td style="vertical-align: top; font-size: 13px; font-weight: 600; color: #64748b;">Description / Consignes</td>
                        <td style="font-size: 13px; color: #334155; line-height: 1.5;">
                          ${tache.description_tache || 'Aucune consigne spécifique transmise.'}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Call to Action -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 28px;">
                <tr>
                  <td align="center">
                    <a href="${plateformeUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 12px; font-size: 14px; font-weight: 700; box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35); text-align: center;">
                      Accéder à la plateforme & Valider l'Intervention →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Message d'information automatique -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #eff6ff; border-radius: 10px; border-left: 4px solid #2563eb; padding: 12px 16px;">
                <tr>
                  <td>
                    <p style="margin: 0; font-size: 12px; color: #1e40af; line-height: 1.5;">
                      <strong>Note :</strong> Ce rappel est généré automatiquement par le service d'ordonnancement de <strong>LA MAIN</strong> toutes les 24h tant que l'opération n'a pas été validée comme « Terminée » ou signalée « Bloquée ».
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 36px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0 0 6px 0; font-size: 12px; font-weight: 600; color: #64748b;">
                Institut des Sciences, des Technologies et des Études Avancées d'Haïti (ISTEAH)
              </p>
              <p style="margin: 0; font-size: 11px; color: #94a3b8;">
                Système LA MAIN &bull; Département Infrastructure & Maintenance Technique
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
                        `,
                        text: messageRappel
                    });
                    console.log(`Email envoyé à ${tache.responsable_email}`);
                } catch (emailErr) {
                    console.error(`❌ Erreur d'envoi email à ${tache.responsable_email} :`, emailErr.message);
                }
            }

            await pool.query(
                `INSERT INTO Notification (message, id_tache, id_responsable) VALUES ($1, $2, $3)`,
                [messageRappel, tache.id_tache, tache.id_responsable]
            );
            console.log(`Notification plateforme créée pour la tâche #${tache.id_tache}`);
        }
    } catch (err) {
        console.error("❌ Erreur Cron Job rappels :", err);
    }
});

// ✅ Cron léger toutes les 10 minutes : passage "En attente" → "En cours"
cron.schedule('*/* * * * *', async () => {
    try {
        await pool.query(`
            UPDATE Tache 
            SET statut = 'En cours' 
            WHERE statut = 'En attente' 
            AND date_echeance <= NOW()
        `);
    } catch (err) {
        console.error("Erreur Cron statut :", err);
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Serveur démarré sur http://localhost:${PORT}`));