const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const cron = require('node-cron');
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

// Route de test
app.get('/test-db', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');
        res.json({ message: "Connexion réussie à PostgreSQL !", date_serveur: result.rows[0].now });
    } catch (err) {
        res.status(500).json({ error: "Erreur de connexion à la BDD" });
    }
});

// --- ROUTES ÉQUIPEMENTS ---
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

// --- ROUTES RESPONSABLES ---
app.get('/api/responsables', async (req, res) => {
    try {
        const result = await pool.query('SELECT id_responsable, nom_responsable, email, role FROM Responsable');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ROUTES TÂCHES ---
app.get('/api/taches', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, e.nom_equipement 
            FROM Tache t
            JOIN Equipement e ON t.id_equipement = e.id_equipement
            ORDER BY t.date_echeance ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/taches', async (req, res) => {
    try {
        const { titre_tache, type_tache, description_tache, date_echeance, frequence, id_equipement } = req.body;
        
        // Déterminer le statut initial selon la date d'échéance par rapport à maintenant
        const maintenant = new Date();
        const echeance = new Date(date_echeance);
        const statutInitial = (echeance <= maintenant) ? 'En cours' : 'En attente';

        const result = await pool.query(
            `INSERT INTO Tache (titre_tache, type_tache, description_tache, date_echeance, frequence, statut, id_equipement) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [titre_tache, type_tache, description_tache, date_echeance, frequence, statutInitial, id_equipement]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ROUTE POUR VALIDER UNE INTERVENTION ---
app.post('/api/interventions', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_tache, id_responsable, commentaire, cout_intervention, statut_resultat } = req.body;
        const dateRealisation = new Date(); // Date de réalisation réelle (Aujourd'hui)

        // 1. Enregistrer l'intervention
        const interResult = await client.query(
            `INSERT INTO Intervention (date_realisation, commentaire, cout_intervention, id_tache, id_responsable) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [dateRealisation, commentaire, cout_intervention || 0.00, id_tache, id_responsable || 1]
        );

        // 2. Récupérer les données de la tâche initiale
        const tacheRes = await client.query('SELECT * FROM Tache WHERE id_tache = $1', [id_tache]);
        const tache = tacheRes.rows[0];

        if (statut_resultat === 'Bloquée') {
            await client.query("UPDATE Tache SET statut = 'Bloquée' WHERE id_tache = $1", [id_tache]);
            await client.query("UPDATE Equipement SET etat = 'En attente de pièce' WHERE id_equipement = $1", [tache.id_equipement]);
        } else {
            // Statut de la tâche actuelle => Terminée
            await client.query("UPDATE Tache SET statut = 'Terminée' WHERE id_tache = $1", [id_tache]);
            await client.query("UPDATE Equipement SET etat = 'Fonctionnel' WHERE id_equipement = $1", [tache.id_equipement]);

            // 3. Calcul de la nouvelle date d'échéance basée sur la date d'intervention + fréquence
            if (tache.frequence && tache.frequence !== 'Ponctuelle') {
                let nouvelleDate = new Date(dateRealisation);
                let freq = tache.frequence.toLowerCase();
                let nombre = 1;
                let match = freq.match(/\d+/);
                if (match) nombre = parseInt(match[0]);

                if (freq.includes('jour')) nouvelleDate.setDate(nouvelleDate.getDate() + nombre);
                else if (freq.includes('semaine')) nouvelleDate.setDate(nouvelleDate.getDate() + (nombre * 7));
                else if (freq.includes('mois')) nouvelleDate.setMonth(nouvelleDate.getMonth() + nombre);
                else if (freq.includes('an') || freq.includes('année')) nouvelleDate.setFullYear(nouvelleDate.getFullYear() + nombre);
                else nouvelleDate.setDate(nouvelleDate.getDate() + 30); // Par défaut 30 jours

                // Créer la nouvelle tâche au statut "En attente"
                await client.query(
                    `INSERT INTO Tache (titre_tache, type_tache, description_tache, date_echeance, frequence, statut, id_equipement)
                     VALUES ($1, $2, $3, $4, $5, 'En attente', $6)`,
                    [tache.titre_tache, tache.type_tache, tache.description_tache, nouvelleDate, tache.frequence, tache.id_equipement]
                );
            }
        }

        await client.query('COMMIT');
        res.status(201).json({ message: "Intervention enregistrée et tâche récurrente recalculée avec succès !" });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// --- ROUTE POUR LES INTERVENTIONS (HISTORIQUE) ---
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

// ==========================================
// TÂCHES AUTOMATIQUES (CRON JOB)
// Vérification régulière pour passer "En attente" -> "En cours" dès l'échéance
// ==========================================
cron.schedule('*/10 * * * * *', async () => {
    try {
        // Déplacer de "En attente" à "En cours" si la date d'échéance est atteinte ou dépassée
        await pool.query(`
            UPDATE Tache 
            SET statut = 'En cours' 
            WHERE statut = 'En attente' 
            AND date_echeance <= NOW()
        `);
    } catch (err) {
        console.error("Erreur lors de la mise à jour des statuts de tâches :", err);
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Serveur démarré sur http://localhost:${PORT}`));