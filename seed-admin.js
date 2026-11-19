// seed-admin.js — Crée le premier compte Admin
// Usage :  node seed-admin.js
// Lit ADMIN_EMAIL et ADMIN_PASSWORD depuis .env (OBLIGATOIRES)
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function main() {
    // ============================================================
    // 1. VÉRIFICATION STRICTE DES VARIABLES D'ENVIRONNEMENT
    // ============================================================
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;

    if (!email || !password) {
        console.error('\n❌ ERREUR : Variables ADMIN_EMAIL et ADMIN_PASSWORD manquantes dans .env\n');
        console.error('   Ajoute ces lignes à ton fichier .env :\n');
        console.error('   ADMIN_EMAIL=ton.vrai.email@exemple.com');
        console.error('   ADMIN_PASSWORD=TonMotDePasseSolide2026!');
        console.error('   ADMIN_NOM=Ton Nom Complet');
        console.error('   ADMIN_NUMERO=+509 XXXX-XXXX');
        console.error('   ADMIN_ID_INST=1\n');
        process.exit(1);
    }

    // Garde-fou : refuse les valeurs d'exemple / trop faibles
    const weakPasswords = ['ChangeMe2026!', '1234', '5678', 'password', 'admin'];
    if (weakPasswords.includes(password)) {
        console.error(`\n❌ ERREUR : Le mot de passe "${password}" est un mot de passe d'exemple.`);
        console.error('   Choisis un mot de passe UNIQUE et SOLIDE dans .env (ADMIN_PASSWORD).\n');
        process.exit(1);
    }

    if (password.length < 8) {
        console.error('\n❌ ERREUR : ADMIN_PASSWORD doit contenir au moins 8 caractères.\n');
        process.exit(1);
    }

    // ============================================================
    // 2. VALEURS OPTIONNELLES (avec fallback raisonnable)
    // ============================================================
    const nom = process.env.ADMIN_NOM || 'Administrateur';
    const numero = process.env.ADMIN_NUMERO || null;
    const id_inst = parseInt(process.env.ADMIN_ID_INST) || 1;

    // ============================================================
    // 3. CRÉATION / MISE À JOUR
    // ============================================================
    try {
        const existing = await pool.query(
            'SELECT id_responsable FROM Responsable WHERE LOWER(email) = LOWER($1)',
            [email]
        );

        const hash = await bcrypt.hash(password, 10);

        if (existing.rows.length > 0) {
            await pool.query(
                `UPDATE Responsable 
                 SET mot_de_passe = $1, role = 'Admin', nom_responsable = $2, numero = COALESCE($3, numero)
                 WHERE id_responsable = $4`,
                [hash, nom, numero, existing.rows[0].id_responsable]
            );
            console.log(`♻️  Admin mis à jour : ${email} (id=${existing.rows[0].id_responsable})`);
        } else {
            const res = await pool.query(
                `INSERT INTO Responsable (nom_responsable, numero, email, mot_de_passe, role, id_inst)
                 VALUES ($1, $2, $3, $4, 'Admin', $5) RETURNING id_responsable`,
                [nom, numero, email, hash, id_inst]
            );
            console.log(`✅ Admin créé : ${email} (id=${res.rows[0].id_responsable})`);
        }

        // Migration douce : hacher tous les mots de passe encore en clair
        const clairs = await pool.query(
            `SELECT id_responsable, mot_de_passe FROM Responsable WHERE mot_de_passe NOT LIKE '$2%'`
        );
        for (const row of clairs.rows) {
            const h = await bcrypt.hash(row.mot_de_passe, 10);
            await pool.query(
                'UPDATE Responsable SET mot_de_passe = $1 WHERE id_responsable = $2',
                [h, row.id_responsable]
            );
            console.log(`   🔐 Ancien mot de passe re-haché : id ${row.id_responsable}`);
        }

        console.log(`\n   Email    : ${email}`);
        console.log(`   Password : ${password}`);
        console.log(`   Nom      : ${nom}`);
        console.log(`\n⚠️  Note ce mot de passe en sécurité — il est haché en base.`);
    } catch (err) {
        if (err.code === '23505') {
            console.error(`\n❌ Cet email est déjà utilisé : ${email}`);
        } else {
            console.error('\n❌ Erreur seed admin :', err.message);
        }
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();