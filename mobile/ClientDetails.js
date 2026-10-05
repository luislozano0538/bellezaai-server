import React, { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

export default function ClientDetails({
  token,
  request,
  logout,
  client,
  onBack,
  onSaved
}) {
  const [name, setName] = useState(client.name || "");
  const [phone, setPhone] = useState(client.phone || "");
  const [email, setEmail] = useState(client.email || "");
  const [notes, setNotes] = useState(client.notes || "");
  const [history, setHistory] = useState([]);
  const [notice, setNotice] = useState("Cargando historial…");
  const [busy, setBusy] = useState(false);

  async function loadHistory() {
    setNotice("Cargando historial…");
    try {
      const data = await request(
        "/api/clients/" + encodeURIComponent(client.id) + "/history",
        { token }
      );
      setHistory(data.appointments || []);
      setNotice("");
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    }
  }

  useEffect(() => { loadHistory(); }, [client.id]);

  async function save() {
    if (busy) return;
    if (!name.trim()) {
      setNotice("Escribe el nombre del cliente.");
      return;
    }

    setBusy(true);
    setNotice("Guardando cliente…");
    try {
      const result = await request(
        "/api/clients/" + encodeURIComponent(client.id),
        {
          token,
          method: "PATCH",
          body: {
            name: name.trim(),
            phone: phone.trim(),
            email: email.trim(),
            notes: notes.trim()
          }
        }
      );
      setName(result.name || "");
      setPhone(result.phone || "");
      setEmail(result.email || "");
      setNotes(result.notes || "");
      setNotice("Cliente actualizado.");
      onSaved?.(result);
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
          <Text style={styles.title}>Cliente</Text>
        </View>
        <Pressable onPress={onBack}><Text style={styles.link}>Volver</Text></Pressable>
      </View>

      {!!notice && <Text style={styles.notice}>{notice}</Text>}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Datos del cliente</Text>

        <Text style={styles.label}>Nombre</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          maxLength={120}
          style={styles.input}
        />

        <Text style={styles.label}>Teléfono</Text>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          maxLength={80}
          keyboardType="phone-pad"
          style={styles.input}
        />

        <Text style={styles.label}>Correo</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          maxLength={254}
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
        />

        <Text style={styles.label}>Notas</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          maxLength={2000}
          multiline
          style={[styles.input, styles.notes]}
          placeholder="Preferencias, fórmulas, observaciones…"
        />

        <Pressable disabled={busy} onPress={save} style={[styles.primary, busy && styles.disabled]}>
          <Text style={styles.primaryText}>{busy ? "Guardando…" : "Guardar cambios"}</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <View style={styles.historyHeader}>
          <Text style={styles.sectionTitle}>Historial de citas</Text>
          <Pressable onPress={loadHistory}><Text style={styles.link}>Actualizar</Text></Pressable>
        </View>

        {history.map(item => (
          <View key={item.id} style={styles.historyItem}>
            <Text style={styles.historyTitle}>{item.service || "Servicio"}</Text>
            <Text style={styles.muted}>{new Date(item.starts_at).toLocaleString()}</Text>
            <Text style={styles.status}>{item.status}</Text>
          </View>
        ))}

        {!history.length && !notice && (
          <Text style={styles.muted}>Este cliente todavía no tiene citas guardadas.</Text>
        )}
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
  label: { color: "#3f3143", fontWeight: "700" },
  input: { borderWidth: 1, borderColor: "#daceda", borderRadius: 13, backgroundColor: "white", paddingHorizontal: 13, paddingVertical: 11, fontSize: 16 },
  notes: { minHeight: 110, textAlignVertical: "top" },
  primary: { backgroundColor: "#74407d", borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  primaryText: { color: "white", fontWeight: "800" },
  disabled: { opacity: 0.5 },
  historyHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  historyItem: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5dce5", paddingTop: 10, gap: 3 },
  historyTitle: { color: "#2d2030", fontWeight: "800" },
  muted: { color: "#756779", lineHeight: 20 },
  status: { color: "#74407d", fontWeight: "700" }
});
