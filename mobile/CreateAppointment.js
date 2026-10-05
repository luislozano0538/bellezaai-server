import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";

function Choice({ selected, title, detail, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}>
      <Text style={[styles.choiceTitle, selected && styles.choiceTitleSelected]}>{title}</Text>
      {!!detail && <Text style={[styles.choiceDetail, selected && styles.choiceDetailSelected]}>{detail}</Text>}
    </Pressable>
  );
}

export default function CreateAppointment({ token, request, logout, onCreated }) {
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [clientId, setClientId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  const [startsAt, setStartsAt] = useState(() => new Date(Date.now() + 60 * 60 * 1000));
  const [notes, setNotes] = useState("");
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [notice, setNotice] = useState("Cargando datos del salón…");
  const [busy, setBusy] = useState(false);

  const selectedService = useMemo(
    () => services.find(item => item.id === serviceId),
    [services, serviceId]
  );

  async function load() {
    setNotice("Actualizando datos…");
    try {
      const [clientRows, serviceRows, professionalRows] = await Promise.all([
        request("/api/clients", { token }),
        request("/api/services", { token }),
        request("/api/professionals", { token })
      ]);
      setClients(clientRows);
      setServices(serviceRows.filter(item => item.active !== false));
      setProfessionals(professionalRows.filter(item => item.active !== false));
      setNotice("");
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    }
  }

  useEffect(() => { load(); }, []);

  function updateDate(next) {
    if (!next) return;
    const value = new Date(startsAt);
    value.setFullYear(next.getFullYear(), next.getMonth(), next.getDate());
    setStartsAt(value);
  }

  function updateTime(next) {
    if (!next) return;
    const value = new Date(startsAt);
    value.setHours(next.getHours(), next.getMinutes(), 0, 0);
    setStartsAt(value);
  }

  async function save() {
    if (busy) return;
    if (!clientId || !serviceId) {
      setNotice("Selecciona un cliente y un servicio.");
      return;
    }
    if (startsAt <= new Date()) {
      setNotice("Selecciona una fecha y hora futuras.");
      return;
    }

    setBusy(true);
    setNotice("Guardando cita…");
    try {
      await request("/api/appointments", {
        token,
        method: "POST",
        body: {
          clientId,
          serviceId,
          professionalId: professionalId || null,
          startsAt: startsAt.toISOString(),
          notes: notes.trim()
        }
      });
      setNotice("Cita creada correctamente.");
      setNotes("");
      onCreated?.();
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
          <Text style={styles.title}>Nueva cita</Text>
        </View>
        <Pressable onPress={load}><Text style={styles.link}>Actualizar</Text></Pressable>
      </View>

      {!!notice && <Text style={styles.notice}>{notice}</Text>}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>1. Cliente</Text>
        {clients.map(client => (
          <Choice
            key={client.id}
            selected={client.id === clientId}
            title={client.name}
            detail={client.phone || client.email || ""}
            onPress={() => setClientId(client.id)}
          />
        ))}
        {!clients.length && !notice && <Text style={styles.muted}>Primero crea un cliente en BellezaAI.</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>2. Servicio</Text>
        {services.map(service => (
          <Choice
            key={service.id}
            selected={service.id === serviceId}
            title={service.name}
            detail={(service.duration_minutes || 0) + " min" + (service.price_label ? " · " + service.price_label : "")}
            onPress={() => setServiceId(service.id)}
          />
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>3. Profesional</Text>
        <Choice
          selected={!professionalId}
          title="Sin preferencia"
          detail="Usar disponibilidad general del salón"
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
        <Text style={styles.sectionTitle}>4. Fecha y hora</Text>
        <View style={styles.dateRow}>
          <Pressable style={styles.dateButton} onPress={() => setShowDate(true)}>
            <Text style={styles.dateButtonLabel}>Fecha</Text>
            <Text style={styles.dateButtonValue}>{startsAt.toLocaleDateString()}</Text>
          </Pressable>
          <Pressable style={styles.dateButton} onPress={() => setShowTime(true)}>
            <Text style={styles.dateButtonLabel}>Hora</Text>
            <Text style={styles.dateButtonValue}>{startsAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>
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

        {!!selectedService && (
          <Text style={styles.muted}>
            Duración: {selectedService.duration_minutes} minutos.
          </Text>
        )}

        <Text style={styles.label}>Notas opcionales</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Color, preferencia, detalle de la cita…"
          multiline
          maxLength={1000}
          style={[styles.input, styles.notes]}
        />
      </View>

      <Pressable disabled={busy} onPress={save} style={[styles.save, busy && styles.disabled]}>
        <Text style={styles.saveText}>{busy ? "Guardando…" : "Crear cita"}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 18, paddingBottom: 44, gap: 14, backgroundColor: "#f8f5f8" },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  eyebrow: { color: "#74407d", fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  title: { fontSize: 28, fontWeight: "800", color: "#2d2030" },
  link: { color: "#74407d", fontWeight: "800", paddingVertical: 4 },
  notice: { color: "#7b3650", lineHeight: 20 },
  card: { backgroundColor: "white", borderWidth: 1, borderColor: "#eadfea", borderRadius: 20, padding: 16, gap: 10 },
  sectionTitle: { fontSize: 19, fontWeight: "800", color: "#2d2030" },
  choice: { borderWidth: 1, borderColor: "#ded4de", borderRadius: 14, padding: 13, backgroundColor: "#fff" },
  choiceSelected: { borderColor: "#74407d", backgroundColor: "#f3eaf5" },
  choiceTitle: { fontWeight: "800", color: "#35283a" },
  choiceTitleSelected: { color: "#62346b" },
  choiceDetail: { marginTop: 3, color: "#756779" },
  choiceDetailSelected: { color: "#74407d" },
  muted: { color: "#756779", lineHeight: 20 },
  dateRow: { flexDirection: "row", gap: 10 },
  dateButton: { flex: 1, borderWidth: 1, borderColor: "#ded4de", borderRadius: 14, padding: 13 },
  dateButtonLabel: { color: "#756779", fontSize: 12, fontWeight: "700" },
  dateButtonValue: { color: "#2d2030", fontSize: 16, fontWeight: "800", marginTop: 4 },
  label: { fontWeight: "700", color: "#3f3143", marginTop: 4 },
  input: { borderWidth: 1, borderColor: "#daceda", backgroundColor: "#fff", borderRadius: 13, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  notes: { minHeight: 90, textAlignVertical: "top" },
  save: { backgroundColor: "#74407d", borderRadius: 15, paddingVertical: 15, alignItems: "center" },
  saveText: { color: "white", fontSize: 16, fontWeight: "800" },
  disabled: { opacity: 0.5 }
});
