import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

export default function StaffAccessScreen({ token, request, logout, goBack }) {
  const [accounts, setAccounts] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [professionalId, setProfessionalId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("Cargando accesos…");
  const [busy, setBusy] = useState(false);

  async function load(message = "Actualizando…") {
    setNotice(message);
    try {
      const [users, team] = await Promise.all([
        request("/api/staff-users", { token }),
        request("/api/professionals", { token })
      ]);
      setAccounts(users);
      setProfessionals(team.filter(item => item.active !== false));
      setNotice("");
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    }
  }

  useEffect(() => { load("Cargando accesos…"); }, []);

  const linked = useMemo(() => new Set(accounts.map(item => item.professional_id)), [accounts]);
  const available = professionals.filter(item => !linked.has(item.id));

  function chooseProfessional(person) {
    setProfessionalId(person.id);
    setName(person.name || "");
  }

  async function createAccess() {
    if (busy) return;
    if (!professionalId || !email.trim() || password.length < 8) {
      setNotice("Selecciona profesional, correo y una contraseña de al menos 8 caracteres.");
      return;
    }
    setBusy(true);
    setNotice("Creando acceso…");
    try {
      await request("/api/staff-users", {
        token,
        method: "POST",
        body: {
          professionalId,
          name: name.trim(),
          email: email.trim(),
          password
        }
      });
      setProfessionalId("");
      setName("");
      setEmail("");
      setPassword("");
      await load("Actualizando accesos…");
      setNotice("Acceso creado.");
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(account) {
    if (busy) return;
    setBusy(true);
    setNotice(account.active ? "Desactivando acceso…" : "Activando acceso…");
    try {
      await request("/api/staff-users/" + encodeURIComponent(account.id), {
        token,
        method: "PATCH",
        body: { active: !account.active }
      });
      await load();
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>BellezaAI</Text>
          <Text style={styles.title}>Accesos del equipo</Text>
        </View>
        <Pressable onPress={goBack}><Text style={styles.link}>Volver</Text></Pressable>
      </View>

      {!!notice && <Text style={styles.notice}>{notice}</Text>}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Crear acceso</Text>
        <Text style={styles.muted}>
          Cada trabajador entra con su propio correo y solo verá su agenda, clientes y recordatorios relacionados.
        </Text>

        <Text style={styles.label}>Profesional</Text>
        <View style={styles.choices}>
          {available.map(person => (
            <Pressable
              key={person.id}
              onPress={() => chooseProfessional(person)}
              style={[styles.choice, professionalId === person.id && styles.choiceSelected]}
            >
              <Text style={[styles.choiceText, professionalId === person.id && styles.choiceTextSelected]}>
                {person.name}
              </Text>
            </Pressable>
          ))}
        </View>
        {!available.length && <Text style={styles.muted}>Todos los profesionales ya tienen una cuenta.</Text>}

        <Text style={styles.label}>Nombre mostrado</Text>
        <TextInput value={name} onChangeText={setName} maxLength={120} style={styles.input} placeholder="Nombre" />

        <Text style={styles.label}>Correo de acceso</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          maxLength={254}
          style={styles.input}
          placeholder="correo@ejemplo.com"
        />

        <Text style={styles.label}>Contraseña inicial</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          maxLength={200}
          style={styles.input}
          placeholder="Mínimo 8 caracteres"
        />

        <Pressable disabled={busy || !available.length} onPress={createAccess} style={[styles.primary, (busy || !available.length) && styles.disabled]}>
          <Text style={styles.primaryText}>Crear acceso</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Cuentas del equipo</Text>
        {accounts.map(account => (
          <View key={account.id} style={styles.item}>
            <View style={styles.grow}>
              <Text style={styles.itemTitle}>{account.professional_name || account.name}</Text>
              <Text style={styles.muted}>{account.email}</Text>
              <Text style={account.active ? styles.active : styles.inactive}>
                {account.active ? "Acceso activo" : "Acceso desactivado"}
              </Text>
            </View>
            <Pressable disabled={busy} onPress={() => toggle(account)} style={styles.secondary}>
              <Text style={styles.secondaryText}>{account.active ? "Desactivar" : "Activar"}</Text>
            </Pressable>
          </View>
        ))}
        {!accounts.length && !notice && <Text style={styles.muted}>Todavía no hay cuentas de trabajadores.</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 18, paddingBottom: 44, gap: 14, backgroundColor: "#f8f5f8" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  eyebrow: { color: "#74407d", fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 28, fontWeight: "800", color: "#2d2030" },
  link: { color: "#74407d", fontWeight: "800", paddingVertical: 4 },
  notice: { color: "#8a3048", lineHeight: 20 },
  card: { backgroundColor: "white", borderWidth: 1, borderColor: "#eadfea", borderRadius: 20, padding: 16, gap: 10 },
  sectionTitle: { fontSize: 20, fontWeight: "800", color: "#2d2030" },
  muted: { color: "#756779", lineHeight: 20 },
  label: { color: "#3f3143", fontWeight: "700" },
  input: { borderWidth: 1, borderColor: "#daceda", borderRadius: 13, paddingHorizontal: 13, paddingVertical: 11, fontSize: 16 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { borderWidth: 1, borderColor: "#daceda", borderRadius: 999, paddingVertical: 8, paddingHorizontal: 11 },
  choiceSelected: { borderColor: "#74407d", backgroundColor: "#f1e7f3" },
  choiceText: { color: "#756779", fontWeight: "700" },
  choiceTextSelected: { color: "#74407d" },
  primary: { backgroundColor: "#74407d", borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  primaryText: { color: "white", fontWeight: "800" },
  secondary: { borderWidth: 1, borderColor: "#74407d", borderRadius: 12, paddingVertical: 9, paddingHorizontal: 11 },
  secondaryText: { color: "#74407d", fontWeight: "800" },
  item: { flexDirection: "row", gap: 12, alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5dce5", paddingTop: 12 },
  grow: { flex: 1 },
  itemTitle: { color: "#2d2030", fontSize: 16, fontWeight: "800" },
  active: { color: "#3c6b4f", fontWeight: "700", marginTop: 3 },
  inactive: { color: "#8a3048", fontWeight: "700", marginTop: 3 },
  disabled: { opacity: 0.5 }
});
