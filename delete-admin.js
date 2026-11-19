require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

(async () => {
    const email = process.argv[2];
    if (!email) {
        console.error('Usage : node delete-admin.js <email>');
        process.exit(1);
    }
    try {
        const res = await pool.query(
            'DELETE FROM Responsable WHERE LOWER(email) = LOWER($1) RETURNING id_responsable, email',
            [email]
        );
        if (res.rows.length === 0) {
            console.log(`❌ Aucun compte trouvé avec l'email : ${email}`);
        } else {
            console.log(`✅ Compte supprimé : ${res.rows[0].email} (id=${res.rows[0].id_responsable})`);
        }
    } catch (err) {
        console.error('Erreur :', err.message);
    } finally {
        await pool.end();
    }
})();