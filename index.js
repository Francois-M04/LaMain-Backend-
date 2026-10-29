const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
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

// Tester la connexion à la base de données
pool.connect((err, client, release) => {
    if (err) {
        return console.error('Erreur de connexion à PostgreSQL :', err.stack);
    }
    console.log('✅ Connexion à PostgreSQL réussie !');
    release();
});

// Route pour tester la base de données
app.get('/test-db', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');
        res.json({ 
            message: "Connexion réussie à PostgreSQL !", 
            date_serveur: result.rows[0].now 
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erreur de connexion à la base de données" });
    }
});

// 1. Route pour LIRE tous les équipements (GET)
app.get('/api/equipements', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM Equipement ORDER BY id_equipement');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erreur lors de la récupération des équipements" });
    }
});

// 2. Route pour AJOUTER un équipement (POST)
app.post('/api/equipements', async (req, res) => {
    try {
        const { nom_equipement, categorie, localisation, etat, id_inst } = req.body;
        const result = await pool.query(
            'INSERT INTO Equipement (nom_equipement, categorie, localisation, etat, id_inst) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [nom_equipement, categorie, localisation, etat, id_inst]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erreur lors de l'ajout de l'équipement" });
    }
});

app.get('/', (req, res) => {
    res.send("Le serveur fonctionne !");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Serveur démarré sur http://localhost:${PORT}`);
});