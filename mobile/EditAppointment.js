import React, { useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";

function Choice({ selected, title, detail, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}>
      <Text style={[styles.choiceTitle, selected && styles.choiceTitleSelected]}>{title}</Text>
      {!!detail && <Text style={styles.muted}>{detail}</Text>}
    </Pressable>
  );
}

export default function EditAppointment({
  token,
  request,
  logout,
  appointment,
  onSaved,
  onCancel
}) {
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [clientId, setClientId] = useState(appointment.client_id || "");
  const [serviceId, setServiceId] = useState(appointment.service_id || "");
  const [professionalId, setProfessionalId] = useState(appointment.professional_id || "");
  const [startsAt, setStartsAt] = useState(new Date(appointment.starts_at));
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [notice, setNotice] = useState("Cargando opciones…");
  const [busy, setBusy] = useState(false);

  const service = useMemo(
    () => services.find(item => item.id === serviceId),
    [services, serviceId]
  );

  async function load() {
    try {
      const [clientRows, serviceRows, professionalRows] = await Promise.all([
        request("/api/clients", { token }),
        request("/api/services?includeArchived=true", { token }),
        request("/api/professionals", { token })
      ]);
      setClients(clientRows);
      setServices(serviceRows);
      setProfessionals(professionalRows.filter(item => item.active !== false));
      setNotice("");
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    }
  }

  useEffect(() => { load(); }, []);

  function updateDate(value) {
    if (!value) return;
    const next = new Date(startsAt);
    next.setFullYear(value.getFullYear(), value.getMonth(), value.getDate());
    setStartsAt(next);
  }

  function updateTime(value) {
    if (!value) return;
    const next = new Date(startsAt);
    next.setHours(value.getHours(), value.getMinutes(), 0, 0);
    setStartsAt(next);
  }

  async function save() {
    if (busy) return;
    if (!clientId || !serviceId || startsAt <= new Date()) {
      setNotice("Selecciona cliente, servicio y una fecha futura.");
      return;
    }

    setBusy(true);
    setNotice("Guardando cambios…");
    try {
      await request("/api/appointments/" + encodeURIComponent(appointment.id), {
        token,
        method: "PATCH",
        body: {
          clientId,
          serviceId,
          professionalId: professionalId || null,
          startsAt: startsAt.toISOString()
        }
      });
      setNotice("Cita actualizada.");
      onSaved();
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>BellezaAI</Text>
          <Text style={styles.title}>Reprogramar cita</Text>
        </View>
        <Pressable onPress={onCancel}><Text style={styles.link}>Volver</Text></Pressable>
      </View>

      <View style={styles.summary}>
        <Text style={styles.summaryTitle}>{appointment.name}</Text>
        <Text style={styles.muted}>{appointment.service}</Text>
        <Text style={styles.muted}>{new Date(appointment.starts_at).toLocaleString()}</Text>
      </View>

      {!!notice && <Text style={styles.notice}>{notice}</Text>}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Cliente</Text>
        {clients.map(client => (
          <Choice
            key={client.id}
            selected={client.id === clientId}
            title={client.name}
            detail={client.phone || client.email || ""}
            onPress={() => setClientId(client.id)}
          />
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Servicio</Text>
        {services.map(item => (
          <Choice
            key={item.id}
            selected={item.id === serviceId}
            title={item.name + (item.active === false ? " (archivado)" : "")}
            detail={item.duration_minutes + " min" + (item.price_label ? " · " + item.price_label : "")}
            onPress={() => setServiceId(item.id)}
          />
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Profesional</Text>
        <Choice
          selected={!professionalId}
          title="Sin preferencia"
          detail="Agenda general del salón"
          onPress={() => setProfessionalId("")}
        />
        {professionals.map(person => (
          <Choice
            key={person.id}
            selected={person.id === professionalId}
            title={person.name}
            detail={(person.specialties || []).join(" · ")}
            onPress={() => setProfessionalId(person.id)}
          />
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Nueva fecha y hora</Text>
        <View style={styles.dateRow}>
          <Pressable style={styles.dateButton} onPress={() => setShowDate(true)}>
            <Text style={styles.dateLabel}>Fecha</Text>
            <Text style={styles.dateValue}>{startsAt.toLocaleDateString()}</Text>
          </Pressable>
          <Pressable style={styles.dateButton} onPress={() => setShowTime(true)}>
            <Text style={styles.dateLabel}>Hora</Text>
            <Text style={styles.dateValue}>{startsAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>
          </Pressable>
        </View>

        {showDate && (
          <DateTimePicker
            value={startsAt}
            mode="date"
            minimumDate={new Date()}
            onChange={(_, value) => {
              setShowDate(Platform.OS === "ios");
              updateDate(value);
            }}
          />
        )}

        {showTime && (
          <DateTimePicker
            value={startsAt}
            mode="time"
            minuteInterval={5}
            onChange={(_, value) => {
              setShowTime(Platform.OS === "ios");
              updateTime(value);
            }}
          />
        )}

        {!!service && <Text style={styles.muted}>Duración: {service.duration_minutes} minutos.</Text>}
      </View>

      <Pressable disabled={busy} onPress={save} style={[styles.primary, busy && styles.disabled]}>
        <Text style={styles.primaryText}>{busy ? "Guardando…" : "Guardar nueva cita"}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 18, paddingBottom: 44, gap: 14, backgroundColor: "#f8f5f8" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  eyebrow: { color: "#74407d", fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 28, fontWeight: "800", color: "#2d2030" },
  link: { color: "#74407d", fontWeight: "800", paddingVertical: 4 },
  summary: { backgroundColor: "#f1e9f3", borderRadius: 16, padding: 14 },
  summaryTitle: { color: "#4b2852", fontSize: 18, fontWeight: "800" },
  notice: { color: "#8a3048", lineHeight: 20 },
  card: { backgroundColor: "white", borderWidth: 1, borderColor: "#eadfea", borderRadius: 20, padding: 16, gap: 10 },
  sectionTitle: { fontSize: 19, fontWeight: "800", color: "#2d2030" },
  choice: { borderWidth: 1, borderColor: "#ded4de", borderRadius: 14, padding: 12 },
  choiceSelected: { borderColor: "#74407d", backgroundColor: "#f3eaf5" },
  choiceTitle: { color: "#35283a", fontWeight: "800" },
  choiceTitleSelected: { color: "#62346b" },
  muted: { color: "#756779", lineHeight: 20 },
  dateRow: { flexDirection: "row", gap: 10 },
  dateButton: { flex: 1, borderWidth: 1, borderColor: "#ded4de", borderRadius: 14, padding: 13 },
  dateLabel: { color: "#756779", fontSize: 12, fontWeight: "700" },
  dateValue: { color: "#2d2030", fontSize: 16, fontWeight: "800", marginTop: 4 },
  primary: { backgroundColor: "#74407d", borderRadius: 15, paddingVertical: 15, alignItems: "center" },
  primaryText: { color: "white", fontSize: 16, fontWeight: "800" },
  disabled: { opacity: 0.5 }
});
