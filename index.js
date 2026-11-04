const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
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

// ✅ Configuration Nodemailer avec tes variables .env
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false, // false pour port 587, true pour 465
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// ✅ Vérification de la connexion SMTP au démarrage
transporter.verify((error, success) => {
    if (error) {
        console.warn('SMTP non disponible (emails désactivés) :', error.message);
    } else {
        console.log('Serveur SMTP prêt à envoyer des emails');
    }
});

app.get('/test-db', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');
        res.json({ message: "Connexion réussie à PostgreSQL !", date_serveur: result.rows[0].now });
    } catch (err) {
        res.status(500).json({ error: "Erreur de connexion à la BDD" });
    }
});

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
            [nom_equipement, categorie, localisation, etat, id_inst || 1]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/equipements/:id', async (req, res) => {
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
        const result = await pool.query('SELECT id_responsable, nom_responsable, numero, email, role FROM Responsable ORDER BY id_responsable');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/responsables', async (req, res) => {
    try {
        const { nom_responsable, numero, email, mot_de_passe, role, id_inst } = req.body;
        const result = await pool.query(
            `INSERT INTO Responsable (nom_responsable, numero, email, mot_de_passe, role, id_inst) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [nom_responsable, numero, email, mot_de_passe, role || 'Responsable', id_inst || 1]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erreur lors de l'ajout du responsable" });
    }
});

app.delete('/api/responsables/:id', async (req, res) => {
    try {
        const { id } = req.params;
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

app.delete('/api/taches/:id', async (req, res) => {
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
        const { id_tache, id_responsable, commentaire, cout_intervention, statut_resultat } = req.body;
        const dateRealisation = new Date();

        const respCheck = await client.query('SELECT id_responsable FROM Responsable LIMIT 1');
        const validRespId = respCheck.rows.length > 0 ? respCheck.rows[0].id_responsable : 1;
        const targetResponsable = id_responsable || validRespId;

        await client.query(
            `INSERT INTO Intervention (date_realisation, commentaire, cout_intervention, id_tache, id_responsable) 
             VALUES ($1, $2, $3, $4, $5)`,
            [dateRealisation, commentaire, cout_intervention || 0.00, id_tache, targetResponsable]
        );

        const tacheRes = await client.query('SELECT * FROM Tache WHERE id_tache = $1', [id_tache]);
        const tache = tacheRes.rows[0];

        // Récupérer l'email + nom du responsable de la tâche pour la notification bloquée
        const respInfo = await client.query(
            'SELECT email, nom_responsable FROM Responsable WHERE id_responsable = $1',
            [tache.id_responsable || targetResponsable]
        );
        const respData = respInfo.rows[0] || { email: null, nom_responsable: 'Responsable inconnu' };

        if (statut_resultat === 'Bloquée') {
            await client.query("UPDATE Tache SET statut = 'Bloquée' WHERE id_tache = $1", [id_tache]);
            await client.query("UPDATE Equipement SET etat = 'En attente de pièce' WHERE id_equipement = $1", [tache.id_equipement]);

            // ✅ Notification PLATEFORME UNIQUEMENT (pas d'email pour un blocage)
            const msgBloquage = `Alerte : La tâche '${tache.titre_tache}' est bloquée. Motif : ${commentaire || 'Non précisé'}. Action requise.`;
            await client.query(
                `INSERT INTO Notification (message, id_tache, id_responsable) VALUES ($1, $2, $3)`,
                [msgBloquage, id_tache, tache.id_responsable || targetResponsable]
            );

            // Notifier aussi l'admin (Wesley) si différent
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

app.delete('/api/notifications', async (req, res) => {
    try {
        await pool.query('DELETE FROM Notification');
        res.json({ message: "Toutes les notifications ont été marquées comme lues." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 6. CRON JOB : RAPPELS EMAIL + PLATEFORME TOUTES LES 24H ---
// ✅ S'exécute chaque jour à 08:00 du matin (heure du serveur)
// Pour tester rapidement, change en '*/1 * * * *' (toutes les minutes)
cron.schedule('* * * * *', async () => {
    console.log('Vérification.');
    
    try {
        // 1️⃣ Passer les tâches "En attente" à "En cours" si échéance atteinte
        await pool.query(`
            UPDATE Tache 
            SET statut = 'En cours' 
            WHERE statut = 'En attente' 
            AND date_echeance <= NOW()
        `);

        // 2️⃣ Récupérer les tâches échues (ni bloquées ni terminées) avec email du responsable
        const tachesEchues = await pool.query(`
            SELECT t.*, r.email AS responsable_email, r.nom_responsable, e.nom_equipement
            FROM Tache t
            JOIN Responsable r ON t.id_responsable = r.id_responsable
            LEFT JOIN Equipement e ON t.id_equipement = e.id_equipement
            WHERE t.date_echeance <= NOW() 
            AND t.statut NOT IN ('Bloquée', 'Terminée')
        `);

        console.log(`${tachesEchues.rows.length} tâche à traiter.`);

        for (const tache of tachesEchues.rows) {
            // ✅ Vérifier qu'un rappel n'a pas déjà été envoyé dans les dernières 24h
            const derniereNotif = await pool.query(`
                SELECT date_envoie FROM Notification 
                WHERE id_tache = $1 
                ORDER BY date_envoie DESC LIMIT 1
            `, [tache.id_tache]);

            let envoyerRappel = true;
            if (derniereNotif.rows.length > 0) {
                const derniereDate = new Date(derniereNotif.rows[0].date_envoie);
                const diffHeures = (new Date() - derniereDate) / (1000 * 60 * 60);
                if (diffHeures < 24) {
                    envoyerRappel = false;
                }
            }

            if (!envoyerRappel) continue;

            const equipementNom = tache.nom_equipement || 'Équipement';
            const dateEcheanceStr = new Date(tache.date_echeance).toLocaleString('fr-FR');

            const messageRappel = `Rappel : La tâche "${tache.titre_tache}" (Équipement : ${equipementNom}) arrive à échéance le ${dateEcheanceStr}. Assignée à ${tache.nom_responsable}. Veuillez procéder à l'intervention ou mettre à jour son statut.`;

            // Envoyer l'email via Nodemailer
            if (tache.responsable_email) {
                try {
                    await transporter.sendMail({
                        from: `"La Main - Gestion Préventive" <${process.env.EMAIL_USER}>`,
                        to: tache.responsable_email,
                        subject: `[Rappel La Main] Tâche urgente : ${tache.titre_tache}`,
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
                                <h2 style="color: #2563eb;">🔔 Rappel de tâche - La Main</h2>
                                <p>Bonjour <strong>${tache.nom_responsable}</strong>,</p>
                                <p>${messageRappel}</p>
                                <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                                    <tr><td style="padding: 8px; border: 1px solid #e2e8f0;"><strong>Tâche</strong></td><td style="padding: 8px; border: 1px solid #e2e8f0;">${tache.titre_tache}</td></tr>
                                    <tr><td style="padding: 8px; border: 1px solid #e2e8f0;"><strong>Équipement</strong></td><td style="padding: 8px; border: 1px solid #e2e8f0;">${equipementNom}</td></tr>
                                    <tr><td style="padding: 8px; border: 1px solid #e2e8f0;"><strong>Échéance</strong></td><td style="padding: 8px; border: 1px solid #e2e8f0;">${dateEcheanceStr}</td></tr>
                                    <tr><td style="padding: 8px; border: 1px solid #e2e8f0;"><strong>Description</strong></td><td style="padding: 8px; border: 1px solid #e2e8f0;">${tache.description_tache || 'N/A'}</td></tr>
                                </table>
                                <p style="margin-top: 20px; color: #64748b; font-size: 12px;">Ce rappel est envoyé automatiquement chaque 24h jusqu'à ce que la tâche soit marquée comme "Terminée" ou "Bloquée".</p>
                            </div>
                        `,
                        text: messageRappel
                    });
                    console.log(`Email envoyé à ${tache.responsable_email} (tâche #${tache.id_tache})`);
                } catch (emailErr) {
                    console.error(`❌ Erreur d'envoi email à ${tache.responsable_email} :`, emailErr.message);
                }
            }

            // Transcrire le rappel dans la table Notification (icône plateforme)
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

// ✅ Cron léger toutes les 10 minutes pour le passage "En attente" → "En cours" (optionnel, plus réactif)
cron.schedule('*/10 * * * *', async () => {
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