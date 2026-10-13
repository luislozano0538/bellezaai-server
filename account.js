// Password reauthentication is separate from the existing bearer session.
export function registerAccount({ app, pool, auth, verifyPassword }) {
  const attempts = new Map();
  app.get('/api/account', auth, (req, res) => res.json({ role: req.user.role, canDelete: ['owner', 'staff'].includes(req.user.role) }));
  app.delete('/api/account', auth, async (req, res) => {
    const { password, confirmation } = req.body || {};
    if (confirmation !== 'ELIMINAR' || typeof password !== 'string' || !password || password.length > 200) {
      return res.status(400).json({ error: 'Escribe ELIMINAR y tu contraseña para continuar.' });
    }
    const now = Date.now();
    for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
    const key = req.user.id;
    const entry = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    if (entry.count >= 5 || attempts.size >= 10000) return res.status(429).json({ error: 'Espera 15 minutos antes de volver a intentarlo.' });
    entry.count++;
    attempts.set(key, entry);
    let db;
    try {
      db = await pool.connect();
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [req.user.salonId]);
      await db.query('SELECT id FROM salons WHERE id=$1 FOR UPDATE', [req.user.salonId]);
      // Read the row so optional auth columns work with both schema versions.
      const result = await db.query('SELECT * FROM users WHERE id=$1 AND salon_id=$2 FOR UPDATE', [req.user.id, req.user.salonId]);
      const user = result.rows[0];
      if (!user || user.active === false ||
          (user.session_version !== undefined && user.session_version !== (req.user.version ?? 0)) ||
          !await verifyPassword(password, user.password_hash)) {
        await db.query('ROLLBACK');
        return res.status(403).json({ error: 'No se pudo verificar la contraseña.' });
      }
      if (user.role === 'owner') {
        // Remove restrictive service references before cascading salon records.
        await db.query('DELETE FROM appointments WHERE salon_id=$1', [req.user.salonId]);
        await db.query('DELETE FROM professional_services WHERE salon_id=$1', [req.user.salonId]);
        await db.query('DELETE FROM salons WHERE id=$1', [req.user.salonId]);
      } else if (user.role === 'staff') {
        await db.query('DELETE FROM users WHERE id=$1 AND salon_id=$2', [req.user.id, req.user.salonId]);
      } else {
        await db.query('ROLLBACK');
        return res.status(403).json({ error: 'No se pudo verificar el tipo de cuenta.' });
      }
      await db.query('COMMIT');
      attempts.delete(key);
      return res.json({ deleted: true });
    } catch {
      if (db) await db.query('ROLLBACK').catch(() => {});
      return res.status(500).json({ error: 'No se pudo completar la eliminación. Vuelve a intentarlo.' });
    } finally { db?.release(); }
  });
}
