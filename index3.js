const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const cron = require('node-cron');
require('dotenv').config(); 

// 1. INITIALISATION D'EXPRESS (C'est ici que 'app' est déclaré)
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

// Test de connexion PostgreSQL
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
        res.status(500).json({ error: "Erreur lors de l'ajout du responsable (email peut-être déjà utilisé)" });
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

        if (statut_resultat === 'Bloquée') {
            await client.query("UPDATE Tache SET statut = 'Bloquée' WHERE id_tache = $1", [id_tache]);
            await client.query("UPDATE Equipement SET etat = 'En attente de pièce' WHERE id_equipement = $1", [tache.id_equipement]);
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

// --- CRON JOB ---
cron.schedule('*/10 * * * * *', async () => {
    try {
        await pool.query(`
            UPDATE Tache 
            SET statut = 'En cours' 
            WHERE statut = 'En attente' 
            AND date_echeance <= NOW()
        `);
    } catch (err) {
        console.error("Erreur Cron Job :", err);
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Serveur démarré sur http://localhost:${PORT}`));