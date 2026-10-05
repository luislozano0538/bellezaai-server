import React, { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";

export default function RemindersScreen({ token, request, logout, goBack }) {
  const [items, setItems] = useState([]);
  const [connected, setConnected] = useState(false);
  const [hoursBefore, setHoursBefore] = useState(24);
  const [notice, setNotice] = useState("Cargando recordatorios…");

  async function load(message = "Actualizando…") {
    setNotice(message);
    try {
      const data = await request("/api/reminders", { token });
      setItems(data.reminders || []);
      setConnected(!!data.connected);
      setHoursBefore(Number(data.hoursBefore || 24));
      setNotice("");
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    }
  }

  useEffect(() => { load("Cargando recordatorios…"); }, []);

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>BellezaAI</Text>
          <Text style={styles.title}>Recordatorios</Text>
        </View>
        <Pressable onPress={goBack}><Text style={styles.link}>Volver</Text></Pressable>
      </View>

      <View style={[styles.banner, connected ? styles.bannerReady : styles.bannerPending]}>
        <Text style={styles.bannerTitle}>
          {connected ? "Mensajería conectada" : "Mensajería pendiente"}
        </Text>
        <Text style={styles.bannerText}>
          {connected
            ? "BellezaAI puede procesar los recordatorios configurados."
            : "Las citas ya preparan el aviso de " + hoursBefore + " horas, pero todavía falta conectar SMS o WhatsApp para enviarlo automáticamente."}
        </Text>
      </View>

      {!!notice && <Text style={styles.notice}>{notice}</Text>}

      <View style={styles.card}>
        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>Avisos pendientes</Text>
          <Pressable onPress={() => load()}><Text style={styles.link}>Actualizar</Text></Pressable>
        </View>

        {items.map(item => (
          <View key={item.id} style={styles.item}>
            <Text style={styles.itemTitle}>{item.client_name}</Text>
            <Text style={styles.muted}>{item.service_name}</Text>
            <Text style={styles.muted}>
              Cita: {new Date(item.starts_at).toLocaleString()}
            </Text>
            <Text style={styles.muted}>
              Aviso previsto: {new Date(item.scheduled_at).toLocaleString()}
            </Text>
            <Text style={styles.status}>
              {item.status === "expired" ? "Hora de aviso vencida" : "Esperando conexión"}
            </Text>
          </View>
        ))}

        {!items.length && !notice && (
          <Text style={styles.muted}>No hay recordatorios pendientes.</Text>
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
  banner: { borderRadius: 18, padding: 16, gap: 5 },
  bannerReady: { backgroundColor: "#e8f3ec" },
  bannerPending: { backgroundColor: "#f7e7ec" },
  bannerTitle: { color: "#2d2030", fontWeight: "800", fontSize: 17 },
  bannerText: { color: "#5e515f", lineHeight: 20 },
  notice: { color: "#8a3048", lineHeight: 20 },
  card: { backgroundColor: "white", borderWidth: 1, borderColor: "#eadfea", borderRadius: 20, padding: 16, gap: 10 },
  listHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  sectionTitle: { fontSize: 20, fontWeight: "800", color: "#2d2030" },
  item: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5dce5", paddingTop: 11, gap: 3 },
  itemTitle: { color: "#2d2030", fontWeight: "800", fontSize: 16 },
  muted: { color: "#756779", lineHeight: 20 },
  status: { color: "#74407d", fontWeight: "700", marginTop: 3 }
});
