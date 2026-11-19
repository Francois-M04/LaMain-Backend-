// auth.js — Routes d'authentification + middlewares JWT
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const JWT_EXPIRES_IN = '7d';

let pool;
function setPool(p) { pool = p; }

// ============================================================
// MIDDLEWARE : authMiddleware
// ============================================================
function authMiddleware(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
        return res.status(401).json({ error: 'Token manquant. Veuillez vous connecter.' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' });
        }
        return res.status(401).json({ error: 'Token invalide.' });
    }
}

// ============================================================
// MIDDLEWARE : requireRole('Admin', ...)
// ============================================================
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Non authentifié.' });
        }
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Accès refusé : rôle insuffisant.' });
        }
        next();
    };
}

// ============================================================
// POST /api/auth/login
// ============================================================
router.post('/login', async (req, res) => {
    try {
        const { email, mot_de_passe } = req.body;

        if (!email || !mot_de_passe) {
            return res.status(400).json({ error: 'Email et mot de passe requis.' });
        }

        const result = await pool.query(
            `SELECT id_responsable, nom_responsable, email, mot_de_passe, role, id_inst, numero
             FROM Responsable WHERE LOWER(email) = LOWER($1)`,
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
        }

        const user = result.rows[0];

        // Migration douce : si le mot de passe n'est pas encore haché, on compare en clair
        // MAIS on le re-hache automatiquement après succès.
        const isHashed = user.mot_de_passe.startsWith('$2');
        let passwordOk = false;

        if (isHashed) {
            passwordOk = await bcrypt.compare(mot_de_passe, user.mot_de_passe);
        } else {
            passwordOk = mot_de_passe === user.mot_de_passe;
            if (passwordOk) {
                const hash = await bcrypt.hash(mot_de_passe, 10);
                await pool.query(
                    'UPDATE Responsable SET mot_de_passe = $1 WHERE id_responsable = $2',
                    [hash, user.id_responsable]
                );
                console.log(`🔐 Mot de passe re-haché automatiquement pour ${user.email}`);
            }
        }

        if (!passwordOk) {
            return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
        }

        const token = jwt.sign(
            {
                id_responsable: user.id_responsable,
                email: user.email,
                role: user.role,
                nom_responsable: user.nom_responsable,
                id_inst: user.id_inst
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.json({
            message: 'Connexion réussie.',
            token,
            user: {
                id_responsable: user.id_responsable,
                nom_responsable: user.nom_responsable,
                email: user.email,
                role: user.role,
                id_inst: user.id_inst,
                numero: user.numero
            }
        });
    } catch (err) {
        console.error('Erreur login :', err);
        res.status(500).json({ error: "Erreur serveur lors de la connexion." });
    }
});

// ============================================================
// POST /api/auth/register  (protégé : Admin uniquement via index.js)
// ============================================================
router.post('/register', async (req, res) => {
    try {
        const { nom_responsable, numero, email, mot_de_passe, role, id_inst } = req.body;

        if (!nom_responsable || !email || !mot_de_passe) {
            return res.status(400).json({ error: 'Nom, email et mot de passe requis.' });
        }

        const hash = await bcrypt.hash(mot_de_passe, 10);

        const result = await pool.query(
            `INSERT INTO Responsable (nom_responsable, numero, email, mot_de_passe, role, id_inst)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id_responsable, nom_responsable, email, role, id_inst`,
            [nom_responsable, numero || null, email, hash, role || 'Responsable', id_inst || 1]
        );

        res.status(201).json({
            message: 'Compte créé avec succès.',
            user: result.rows[0]
        });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
        }
        console.error('Erreur register :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ============================================================
// GET /api/auth/me  (protégé par authMiddleware directement ici)
// ============================================================
router.get('/me', authMiddleware, (req, res) => {
    const { id_responsable, nom_responsable, email, role, id_inst } = req.user;
    res.json({ user: { id_responsable, nom_responsable, email, role, id_inst } });
});

module.exports = { router, setPool, authMiddleware, requireRole };