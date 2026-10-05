import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import * as SecureStore from "expo-secure-store";
import CreateAppointment from "./CreateAppointment";
import AssistantScreen from "./AssistantScreen";
import SalonManagement from "./SalonManagement";
import EditAppointment from "./EditAppointment";
import SalonSettings from "./SalonSettings";
import PublicProfileSettings from "./PublicProfileSettings";
import ClientDetails from "./ClientDetails";
import ClosuresScreen from "./ClosuresScreen";

const TOKEN_KEY = "bellezaai_token";
const API_URL = String(process.env.EXPO_PUBLIC_API_URL || "https://bellezaai-server.onrender.com").replace(/\/$/, "");

async function api(path, { token, method = "GET", body } = {}) {
  if (!API_URL) throw new Error("Falta configurar EXPO_PUBLIC_API_URL.");
  const response = await fetch(API_URL + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(data.error || "No se pudo completar la solicitud.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function Button({ children, onPress, disabled, secondary }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.buttonSecondary,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.buttonSecondaryText]}>
        {children}
      </Text>
    </Pressable>
  );
}

function Login({ onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit() {
    if (busy) return;
    if (!email.trim() || !password) {
      setNotice("Escribe tu correo y contraseña.");
      return;
    }
    setBusy(true);
    setNotice("Entrando…");
    try {
      const result = await api("/api/auth/login", {
        method: "POST",
        body: { email: email.trim(), password }
      });
      await SecureStore.setItemAsync(TOKEN_KEY, result.token);
      onLoggedIn(result.token);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <SafeAreaView style={styles.flex}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.login}>
          <View style={styles.logo}><Text style={styles.logoText}>B</Text></View>
          <Text style={styles.title}>BellezaAI</Text>
          <Text style={styles.subtitle}>Tu salón, clientes y agenda en un solo lugar.</Text>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Iniciar sesión</Text>
            <Text style={styles.label}>Correo</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              placeholder="tu@correo.com"
            />
            <Text style={styles.label}>Contraseña</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
              placeholder="••••••••"
              onSubmitEditing={submit}
            />
            {!!notice && <Text style={styles.notice}>{notice}</Text>}
            <Button onPress={submit} disabled={busy}>{busy ? "Entrando…" : "Entrar"}</Button>
          </View>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function Metric({ value, label }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function Home({ token, logout, navigate }) {
  const [data, setData] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [notice, setNotice] = useState("Cargando…");
  const [busy, setBusy] = useState(false);

  async function load() {
    if (busy) return;
    setBusy(true);
    setNotice("Actualizando…");
    try {
      const [dashboard, profile, salon, appts] = await Promise.all([
        api("/api/dashboard", { token }),
        api("/api/profile", { token }),
        api("/api/salon", { token }),
        api("/api/appointments", { token })
      ]);
      setData({ dashboard, profile, salon });
      setAppointments(appts);
      setNotice("");
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { load(); }, []);

  const nextAppointments = useMemo(() => appointments
    .filter(item => item.status !== "cancelled" && new Date(item.starts_at) >= new Date())
    .slice(0, 5), [appointments]);

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.eyebrow}>BellezaAI</Text>
          <Text style={styles.screenTitle}>{data?.salon?.name || "Tu salón"}</Text>
          <Text style={styles.muted}>Hola, {data?.profile?.name || "propietario"}</Text>
        </View>
        <Pressable onPress={load} disabled={busy}><Text style={styles.link}>{busy ? "…" : "Actualizar"}</Text></Pressable>
      </View>

      {!!notice && <Text style={styles.notice}>{notice}</Text>}

      <View style={styles.metrics}>
        <Metric value={data?.dashboard?.appointments ?? "—"} label="Citas" />
        <Metric value={data?.dashboard?.clients ?? "—"} label="Clientes" />
        <Metric value={data?.dashboard?.pendingReminders ?? "—"} label="Recordatorios" />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Próximas citas</Text>
        {nextAppointments.length ? nextAppointments.map(item => (
          <View key={item.id} style={styles.row}>
            <View style={styles.rowGrow}>
              <Text style={styles.rowTitle}>{item.name}</Text>
              <Text style={styles.muted}>{item.service}{item.professional_name ? " · " + item.professional_name : ""}</Text>
              <Text style={styles.muted}>{new Date(item.starts_at).toLocaleString()}</Text>
            </View>
          </View>
        )) : <Text style={styles.muted}>No hay próximas citas.</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Administrar salón</Text>
        <Text style={styles.muted}>Agrega servicios y profesionales desde el teléfono.</Text>
        <Button onPress={() => navigate("management")}>Servicios y equipo</Button>
        <Button secondary onPress={() => navigate("salonSettings")}>Horario y reservas</Button>
        <Button secondary onPress={() => navigate("publicProfile")}>Perfil público</Button>
        <Button secondary onPress={() => navigate("closures")}>Bloqueos y días libres</Button>
      </View>

      <Button secondary onPress={logout}>Cerrar sesión</Button>
    </ScrollView>
  );
}

function Appointments({ token, logout, onEdit }) {
  const [items, setItems] = useState([]);
  const [notice, setNotice] = useState("Cargando citas…");
  const [cancelId, setCancelId] = useState("");
  const [busyId, setBusyId] = useState("");

  async function load(message = "Actualizando…") {
    setNotice(message);
    try {
      setItems(await api("/api/appointments", { token }));
      setNotice("");
      setCancelId("");
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    }
  }

  async function cancelAppointment(id) {
    if (busyId) return;
    setBusyId(id);
    setNotice("Cancelando cita…");
    try {
      await api("/api/appointments/" + encodeURIComponent(id), {
        token,
        method: "PATCH",
        body: { status: "cancelled" }
      });
      await load("Actualizando agenda…");
      setNotice("Cita cancelada.");
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    } finally {
      setBusyId("");
    }
  }

  async function markAttendance(item, status) {
    if (busyId) return;
    setBusyId(item.id);
    setNotice(status === "completed" ? "Marcando como atendida…" : "Marcando no asistió…");
    try {
      await api("/api/appointments/" + encodeURIComponent(item.id) + "/attendance", {
        token,
        method: "PATCH",
        body: { status, expectedStatus: item.status }
      });
      await load("Actualizando agenda…");
      setNotice(status === "completed" ? "Cita marcada como atendida." : "Cita marcada como no asistió.");
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    } finally {
      setBusyId("");
    }
  }

  useEffect(() => { load("Cargando citas…"); }, []);

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.headerRow}>
        <Text style={styles.screenTitle}>Citas</Text>
        <Pressable onPress={() => load()}><Text style={styles.link}>Actualizar</Text></Pressable>
      </View>
      {!!notice && <Text style={styles.notice}>{notice}</Text>}
      {items.map(item => {
        const now = new Date();
        const futureConfirmed = item.status === "confirmed" && new Date(item.starts_at) > now;
        const startedConfirmed = item.status === "confirmed" && new Date(item.starts_at) <= now;
        const canComplete = startedConfirmed && new Date(item.ends_at) <= now;
        const confirming = cancelId === item.id;
        return (
          <View key={item.id} style={styles.card}>
            <Text style={styles.rowTitle}>{item.name}</Text>
            <Text style={styles.muted}>{item.service}</Text>
            <Text style={styles.muted}>{new Date(item.starts_at).toLocaleString()}</Text>
            <Text style={styles.muted}>{item.professional_name || "Sin profesional asignado"}</Text>
            <Text style={styles.status}>{item.status}</Text>

            {futureConfirmed && !confirming && (
              <View style={styles.actionRow}>
                <Pressable onPress={() => onEdit(item)} style={styles.smallAction}>
                  <Text style={styles.smallActionText}>Reprogramar</Text>
                </Pressable>
                <Pressable onPress={() => setCancelId(item.id)} style={styles.smallAction}>
                  <Text style={styles.smallActionText}>Cancelar cita</Text>
                </Pressable>
              </View>
            )}

            {startedConfirmed && (
              <View style={styles.actionRow}>
                {canComplete && (
                  <Pressable
                    disabled={busyId === item.id}
                    onPress={() => markAttendance(item, "completed")}
                    style={styles.smallAction}
                  >
                    <Text style={styles.smallActionText}>Atendida</Text>
                  </Pressable>
                )}
                <Pressable
                  disabled={busyId === item.id}
                  onPress={() => markAttendance(item, "no_show")}
                  style={styles.smallAction}
                >
                  <Text style={styles.smallActionText}>No asistió</Text>
                </Pressable>
              </View>
            )}

            {futureConfirmed && confirming && (
              <View style={styles.confirmBox}>
                <Text style={styles.notice}>¿Seguro? El horario quedará libre.</Text>
                <Pressable
                  disabled={busyId === item.id}
                  onPress={() => cancelAppointment(item.id)}
                  style={[styles.dangerAction, busyId === item.id && styles.disabled]}
                >
                  <Text style={styles.dangerActionText}>
                    {busyId === item.id ? "Cancelando…" : "Sí, cancelar"}
                  </Text>
                </Pressable>
                <Pressable disabled={!!busyId} onPress={() => setCancelId("")} style={styles.smallAction}>
                  <Text style={styles.smallActionText}>Conservar cita</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}
      {!items.length && !notice && <Text style={styles.muted}>No hay citas guardadas.</Text>}
    </ScrollView>
  );
}

function Clients({ token, logout, onSelect }) {
  const [items, setItems] = useState([]);
  const [notice, setNotice] = useState("Cargando clientes…");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  async function load(message = "Actualizando…") {
    setNotice(message);
    try {
      setItems(await api("/api/clients", { token }));
      setNotice("");
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    }
  }

  async function createClient() {
    if (busy) return;
    if (!name.trim()) {
      setNotice("Escribe el nombre del cliente.");
      return;
    }
    setBusy(true);
    setNotice("Guardando cliente…");
    try {
      await api("/api/clients", {
        token,
        method: "POST",
        body: { name: name.trim(), phone: phone.trim(), email: email.trim(), notes: "" }
      });
      setName("");
      setPhone("");
      setEmail("");
      setShowForm(false);
      await load("Actualizando clientes…");
      setNotice("Cliente guardado.");
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { load("Cargando clientes…"); }, []);

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.screen}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.screenTitle}>Clientes</Text>
          <Pressable onPress={() => setShowForm(value => !value)}>
            <Text style={styles.link}>{showForm ? "Cerrar formulario" : "+ Nuevo cliente"}</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => load()}><Text style={styles.link}>Actualizar</Text></Pressable>
      </View>

      {!!notice && <Text style={styles.notice}>{notice}</Text>}

      {showForm && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Nuevo cliente</Text>
          <Text style={styles.label}>Nombre</Text>
          <TextInput value={name} onChangeText={setName} maxLength={120} style={styles.input} placeholder="Nombre del cliente" />
          <Text style={styles.label}>Teléfono</Text>
          <TextInput value={phone} onChangeText={setPhone} maxLength={80} keyboardType="phone-pad" style={styles.input} placeholder="Teléfono" />
          <Text style={styles.label}>Correo opcional</Text>
          <TextInput value={email} onChangeText={setEmail} maxLength={254} autoCapitalize="none" keyboardType="email-address" style={styles.input} placeholder="correo@ejemplo.com" />
          <Button disabled={busy} onPress={createClient}>{busy ? "Guardando…" : "Guardar cliente"}</Button>
        </View>
      )}

      {items.map(item => (
        <Pressable
          key={item.id}
          onPress={() => onSelect(item)}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        >
          <Text style={styles.rowTitle}>{item.name}</Text>
          {!!item.phone && <Text style={styles.muted}>{item.phone}</Text>}
          {!!item.email && <Text style={styles.muted}>{item.email}</Text>}
          <Text style={styles.muted}>{item.appointment_count || 0} cita(s)</Text>
          <Text style={styles.link}>Ver y editar cliente</Text>
        </Pressable>
      ))}
      {!items.length && !notice && <Text style={styles.muted}>No hay clientes guardados.</Text>}
    </ScrollView>
  );
}

function Shell({ token, logout }) {
  const [tab, setTab] = useState("home");
  const [editingAppointment, setEditingAppointment] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);
  function editAppointment(item) { setEditingAppointment(item); setTab("editAppointment"); }
  function finishEditing() { setEditingAppointment(null); setTab("appointments"); }
  function openClient(item) { setSelectedClient(item); setTab("clientDetails"); }
  function closeClient() { setSelectedClient(null); setTab("clients"); }
  function updateSelectedClient(item) { setSelectedClient(current => current ? { ...current, ...item } : item); }
  return (
    <SafeAreaView style={styles.flex}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.flex}>
        {tab === "home" && <Home token={token} logout={logout} navigate={setTab} />}
        {tab === "appointments" && <Appointments token={token} logout={logout} onEdit={editAppointment} />}
        {tab === "clients" && <Clients token={token} logout={logout} onSelect={openClient} />}
        {tab === "create" && <CreateAppointment token={token} request={api} logout={logout} onCreated={() => setTab("appointments")} />}
        {tab === "assistant" && <AssistantScreen token={token} request={api} logout={logout} />}
        {tab === "management" && <SalonManagement token={token} request={api} logout={logout} goBack={() => setTab("home")} />}
        {tab === "editAppointment" && editingAppointment && <EditAppointment token={token} request={api} logout={logout} appointment={editingAppointment} onSaved={finishEditing} onCancel={finishEditing} />}
        {tab === "salonSettings" && <SalonSettings token={token} request={api} logout={logout} baseUrl={API_URL} goBack={() => setTab("home")} />}
        {tab === "publicProfile" && <PublicProfileSettings token={token} request={api} logout={logout} baseUrl={API_URL} goBack={() => setTab("home")} />}
        {tab === "clientDetails" && selectedClient && <ClientDetails token={token} request={api} logout={logout} client={selectedClient} onBack={closeClient} onSaved={updateSelectedClient} />}
        {tab === "closures" && <ClosuresScreen token={token} request={api} logout={logout} goBack={() => setTab("home")} />}
      </View>
      <View style={styles.nav}>
        {[
          ["home", "Inicio"],
          ["appointments", "Citas"],
          ["clients", "Clientes"],
          ["assistant", "IA"],
          ["create", "Nueva"]
        ].map(([key, label]) => (
          <Pressable key={key} onPress={() => setTab(key)} style={styles.navItem}>
            <Text style={[styles.navText, tab === key && styles.navActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  const [token, setToken] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    SecureStore.getItemAsync(TOKEN_KEY)
      .then(setToken)
      .finally(() => setBooting(false));
  }, []);

  async function logout() {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setToken(null);
  }

  if (booting) {
    return (
      <SafeAreaView style={[styles.flex, styles.center]}>
        <ActivityIndicator />
        <Text style={styles.muted}>Abriendo BellezaAI…</Text>
      </SafeAreaView>
    );
  }

  return token
    ? <Shell token={token} logout={logout} />
    : <Login onLoggedIn={setToken} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#f8f5f8" },
  center: { alignItems: "center", justifyContent: "center", gap: 12 },
  login: { flexGrow: 1, justifyContent: "center", padding: 24 },
  logo: {
    width: 72, height: 72, borderRadius: 24, backgroundColor: "#74407d",
    alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 16
  },
  logoText: { color: "white", fontSize: 36, fontWeight: "800" },
  title: { fontSize: 34, fontWeight: "800", textAlign: "center", color: "#2d2030" },
  subtitle: { textAlign: "center", color: "#756779", marginTop: 8, marginBottom: 28, fontSize: 16 },
  screen: { padding: 18, paddingBottom: 40, gap: 14 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  eyebrow: { color: "#74407d", fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  screenTitle: { fontSize: 28, fontWeight: "800", color: "#2d2030" },
  card: {
    backgroundColor: "white", borderRadius: 20, padding: 18,
    borderWidth: 1, borderColor: "#eadfea", gap: 10
  },
  cardTitle: { fontSize: 20, fontWeight: "800", color: "#2d2030" },
  label: { fontWeight: "700", color: "#3f3143", marginTop: 6 },
  input: {
    borderWidth: 1, borderColor: "#daceda", backgroundColor: "#fff",
    borderRadius: 13, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16
  },
  notice: { color: "#7b3650", lineHeight: 20 },
  button: {
    borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18,
    backgroundColor: "#74407d", alignItems: "center", marginTop: 6
  },
  buttonSecondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#74407d" },
  buttonText: { color: "white", fontWeight: "800", fontSize: 16 },
  buttonSecondaryText: { color: "#74407d" },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  metrics: { flexDirection: "row", gap: 10 },
  metric: {
    flex: 1, backgroundColor: "white", borderWidth: 1, borderColor: "#eadfea",
    borderRadius: 18, padding: 14
  },
  metricValue: { fontSize: 26, fontWeight: "800", color: "#74407d" },
  metricLabel: { fontSize: 12, color: "#756779", marginTop: 4 },
  row: { flexDirection: "row", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e8dfe8" },
  rowGrow: { flex: 1 },
  rowTitle: { fontWeight: "800", fontSize: 16, color: "#2d2030" },
  muted: { color: "#756779", lineHeight: 20 },
  status: { alignSelf: "flex-start", marginTop: 4, fontWeight: "700", color: "#74407d" },
  link: { color: "#74407d", fontWeight: "800", paddingVertical: 4 },
  nav: {
    flexDirection: "row", backgroundColor: "white", borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#ded4de", paddingBottom: Platform.OS === "android" ? 8 : 0
  },
  navItem: { flex: 1, alignItems: "center", paddingVertical: 14 },
  navText: { color: "#887b8b", fontWeight: "700" },
  navActive: { color: "#74407d" },
  smallAction: { alignSelf: "flex-start", borderWidth: 1, borderColor: "#74407d", borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12, marginTop: 6 },
  smallActionText: { color: "#74407d", fontWeight: "800" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  confirmBox: { gap: 8, paddingTop: 6 },
  dangerAction: { alignSelf: "flex-start", backgroundColor: "#a02d43", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 13 },
  dangerActionText: { color: "white", fontWeight: "800" }
});
