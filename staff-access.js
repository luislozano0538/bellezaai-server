import crypto from "crypto";
import bcrypt from "bcryptjs";

const uuid = value =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function registerStaffAccess({ app, pool, auth }) {
  app.get("/api/staff-users", auth, async (req, res) => {
    if (req.user.role !== "owner") {
      return res.status(403).json({ error: "Solo el propietario puede gestionar accesos del equipo." });
    }

    try {
      const q = await pool.query(
        `SELECT u.id,u.name,u.email,u.active,u.professional_id,
                p.name AS professional_name
         FROM users u
         LEFT JOIN professionals p
           ON p.id=u.professional_id AND p.salon_id=u.salon_id
         WHERE u.salon_id=$1 AND u.role='staff'
         ORDER BY u.name,u.email`,
        [req.user.salonId]
      );

      res.json(q.rows);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "No se pudieron cargar los accesos del equipo." });
    }
  });

  app.post("/api/staff-users", auth, async (req, res) => {
    if (req.user.role !== "owner") {
      return res.status(403).json({ error: "Solo el propietario puede crear accesos del equipo." });
    }

    const { professionalId, email, password, name = "" } = req.body || {};

    if (
      !uuid(professionalId) ||
      typeof email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== "string" ||
      password.length < 8 ||
      password.length > 200 ||
      typeof name !== "string" ||
      name.length > 120
    ) {
      return res.status(400).json({
        error: "Revisa profesional, correo y contraseña (mínimo 8 caracteres)."
      });
    }

    const db = await pool.connect();

    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [req.user.salonId]);

      const professional = (
        await db.query(
          "SELECT id,name FROM professionals WHERE id=$1 AND salon_id=$2 AND active=true FOR SHARE",
          [professionalId, req.user.salonId]
        )
      ).rows[0];

      if (!professional) {
        await db.query("ROLLBACK");
        return res.status(404).json({ error: "Profesional no encontrado o inactivo." });
      }

      const existingProfessional = (
        await db.query(
          "SELECT id FROM users WHERE professional_id=$1 LIMIT 1",
          [professionalId]
        )
      ).rows[0];

      if (existingProfessional) {
        await db.query("ROLLBACK");
        return res.status(409).json({ error: "Ese profesional ya tiene una cuenta de acceso." });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const existingEmail = (
        await db.query("SELECT id FROM users WHERE email=$1 LIMIT 1", [normalizedEmail])
      ).rows[0];

      if (existingEmail) {
        await db.query("ROLLBACK");
        return res.status(409).json({ error: "Ese correo ya está en uso." });
      }

      const hash = await bcrypt.hash(password, 12);
      const id = crypto.randomUUID();

      const result = await db.query(
        `INSERT INTO users
          (id,salon_id,email,password_hash,name,role,professional_id,active)
         VALUES($1,$2,$3,$4,$5,'staff',$6,true)
         RETURNING id,name,email,professional_id,active`,
        [
          id,
          req.user.salonId,
          normalizedEmail,
          hash,
          name.trim() || professional.name,
          professionalId
        ]
      );

      await db.query("COMMIT");

      res.status(201).json({
        ...result.rows[0],
        professional_name: professional.name
      });
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      console.error(error);
      res.status(500).json({ error: "No se pudo crear el acceso del profesional." });
    } finally {
      db.release();
    }
  });

  app.patch("/api/staff-users/:id/password", auth, async (req, res) => {
    if (req.user.role !== "owner") {
      return res.status(403).json({ error: "Solo el propietario puede cambiar contraseñas del equipo." });
    }

    if (
      !uuid(req.params.id) ||
      typeof req.body?.password !== "string" ||
      req.body.password.length < 8 ||
      req.body.password.length > 200
    ) {
      return res.status(400).json({ error: "La nueva contraseña debe tener al menos 8 caracteres." });
    }

    try {
      const hash = await bcrypt.hash(req.body.password, 12);
      const q = await pool.query(
        `UPDATE users
         SET password_hash=$3
         WHERE id=$1 AND salon_id=$2 AND role='staff'
         RETURNING id`,
        [req.params.id, req.user.salonId, hash]
      );

      if (!q.rows[0]) {
        return res.status(404).json({ error: "Acceso no encontrado." });
      }

      res.json({ saved: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "No se pudo cambiar la contraseña." });
    }
  });

  app.patch("/api/staff-users/:id", auth, async (req, res) => {
    if (req.user.role !== "owner") {
      return res.status(403).json({ error: "Solo el propietario puede gestionar accesos del equipo." });
    }

    if (!uuid(req.params.id) || typeof req.body?.active !== "boolean") {
      return res.status(400).json({ error: "Acceso inválido." });
    }

    try {
      const q = await pool.query(
        `UPDATE users
         SET active=$3
         WHERE id=$1 AND salon_id=$2 AND role='staff'
         RETURNING id,name,email,professional_id,active`,
        [req.params.id, req.user.salonId, req.body.active]
      );

      if (!q.rows[0]) {
        return res.status(404).json({ error: "Acceso no encontrado." });
      }

      res.json(q.rows[0]);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "No se pudo actualizar el acceso." });
    }
  });
}
