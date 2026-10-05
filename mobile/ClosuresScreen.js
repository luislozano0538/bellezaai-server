import React, { useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function minuteOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 3) | 8;
    return v.toString(16);
  });
}

export default function ClosuresScreen({ token, request, logout, goBack }) {
  const [closures, setClosures] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [timezone, setTimezone] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  const [mode, setMode] = useState("day");
  const [startDate, setStartDate] = useState(() => new Date());
  const [endDate, setEndDate] = useState(() => new Date());
  const [startTime, setStartTime] = useState(() => {
    const d = new Date(); d.setHours(12, 0, 0, 0); return d;
  });
  const [endTime, setEndTime] = useState(() => {
    const d = new Date(); d.setHours(13, 0, 0, 0); return d;
  });
  const [reason, setReason] = useState("");
  const [picker, setPicker] = useState("");
  const [notice, setNotice] = useState("Cargando bloqueos…");
  const [busy, setBusy] = useState(false);

  const selectedProfessional = useMemo(
    () => professionals.find(p => p.id === professionalId),
    [professionals, professionalId]
  );

  async function load(message = "Actualizando…") {
    setNotice(message);
    try {
      const [closureData, team] = await Promise.all([
        request("/api/salon/closures", { token }),
        request("/api/professionals", { token })
      ]);
      setClosures(closureData.closures || []);
      setTimezone(closureData.timezone || "");
      setProfessionals(team.filter(person => person.active !== false));
      setNotice("");
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    }
  }

  useEffect(() => { load("Cargando bloqueos…"); }, []);

  function resetForm() {
    setProfessionalId("");
    setMode("day");
    setStartDate(new Date());
    setEndDate(new Date());
    const a = new Date(); a.setHours(12, 0, 0, 0); setStartTime(a);
    const b = new Date(); b.setHours(13, 0, 0, 0); setEndTime(b);
    setReason("");
    setPicker("");
  }

  async function save() {
    if (busy) return;

    const startsOn = localDateString(startDate);
    const endsOn = mode === "hour" ? startsOn : localDateString(endDate);
    const startsMinute = mode === "hour" ? minuteOfDay(startTime) : null;
    const endsMinute = mode === "hour" ? minuteOfDay(endTime) : null;

    if (startsOn > endsOn) {
      setNotice("La fecha final no puede ser anterior a la inicial.");
      return;
    }
    if (mode === "hour" && startsMinute >= endsMinute) {
      setNotice("La hora final debe ser posterior a la inicial.");
      return;
    }

    setBusy(true);
    setNotice("Guardando bloqueo…");
    try {
      const result = await request("/api/salon/closures", {
        token,
        method: "POST",
        body: {
          startsOn,
          endsOn,
          professionalId: professionalId || null,
          reason: reason.trim(),
          requestId: uuid(),
          startsMinute,
          endsMinute
        }
      });
      const affected = Number(result.affectedAppointments || 0);
      resetForm();
      await load("Actualizando bloqueos…");
      setNotice(
        affected
          ? "Bloqueo guardado. Revisa " + affected + " cita(s) afectada(s)."
          : "Bloqueo guardado."
      );
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(item) {
    if (busy) return;
    setBusy(true);
    setNotice("Quitando bloqueo…");
    try {
      await request("/api/salon/closures/" + encodeURIComponent(item.id), {
        token,
        method: "PATCH",
        body: { active: false }
      });
      await load("Actualizando bloqueos…");
      setNotice("Bloqueo quitado.");
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  function closureLabel(item) {
    if (item.starts_minute !== null && item.ends_minute !== null) {
      const hm = value => String(Math.floor(value / 60)).padStart(2, "0") + ":" +
        String(value % 60).padStart(2, "0");
      return item.starts_on + " · " + hm(item.starts_minute) + "–" + hm(item.ends_minute);
    }
    return item.starts_on === item.ends_on
      ? item.starts_on
      : item.starts_on + " → " + item.ends_on;
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>BellezaAI</Text>
          <Text style={styles.title}>Bloqueos y días libres</Text>
        </View>
        <Pressable onPress={goBack}><Text style={styles.link}>Volver</Text></Pressable>
      </View>

      {!!timezone && <Text style={styles.muted}>Zona horaria: {timezone}</Text>}
      {!!notice && <Text style={styles.notice}>{notice}</Text>}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Nuevo bloqueo</Text>

        <Text style={styles.label}>Aplicar a</Text>
        <View style={styles.choices}>
          <Pressable
            onPress={() => setProfessionalId("")}
            style={[styles.choice, !professionalId && styles.choiceSelected]}
          >
            <Text style={[styles.choiceText, !professionalId && styles.choiceTextSelected]}>
              Todo el salón
            </Text>
          </Pressable>
          {professionals.map(person => (
            <Pressable
              key={person.id}
              onPress={() => setProfessionalId(person.id)}
              style={[styles.choice, professionalId === person.id && styles.choiceSelected]}
            >
              <Text style={[styles.choiceText, professionalId === person.id && styles.choiceTextSelected]}>
                {person.name}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Tipo</Text>
        <View style={styles.modeRow}>
          {[
            ["day", "Día(s) completo(s)"],
            ["hour", "Unas horas"]
          ].map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => setMode(key)}
              style={[styles.mode, mode === key && styles.modeSelected]}
            >
              <Text style={[styles.modeText, mode === key && styles.modeTextSelected]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Fecha inicial</Text>
        <Pressable style={styles.dateButton} onPress={() => setPicker("startDate")}>
          <Text style={styles.dateValue}>{startDate.toLocaleDateString()}</Text>
        </Pressable>

        {mode === "day" && (
          <>
            <Text style={styles.label}>Fecha final</Text>
            <Pressable style={styles.dateButton} onPress={() => setPicker("endDate")}>
              <Text style={styles.dateValue}>{endDate.toLocaleDateString()}</Text>
            </Pressable>
          </>
        )}

        {mode === "hour" && (
          <View style={styles.timeRow}>
            <View style={styles.timeCol}>
              <Text style={styles.label}>Desde</Text>
              <Pressable style={styles.dateButton} onPress={() => setPicker("startTime")}>
                <Text style={styles.dateValue}>
                  {startTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </Text>
              </Pressable>
            </View>
            <View style={styles.timeCol}>
              <Text style={styles.label}>Hasta</Text>
              <Pressable style={styles.dateButton} onPress={() => setPicker("endTime")}>
                <Text style={styles.dateValue}>
                  {endTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {picker === "startDate" && (
          <DateTimePicker
            value={startDate}
            mode="date"
            minimumDate={new Date()}
            onChange={(_, value) => {
              setPicker(Platform.OS === "ios" ? "startDate" : "");
              if (value) {
                setStartDate(value);
                if (endDate < value) setEndDate(value);
              }
            }}
          />
        )}

        {picker === "endDate" && (
          <DateTimePicker
            value={endDate}
            mode="date"
            minimumDate={startDate}
            onChange={(_, value) => {
              setPicker(Platform.OS === "ios" ? "endDate" : "");
              if (value) setEndDate(value);
            }}
          />
        )}

        {picker === "startTime" && (
          <DateTimePicker
            value={startTime}
            mode="time"
            minuteInterval={5}
            onChange={(_, value) => {
              setPicker(Platform.OS === "ios" ? "startTime" : "");
              if (value) setStartTime(value);
            }}
          />
        )}

        {picker === "endTime" && (
          <DateTimePicker
            value={endTime}
            mode="time"
            minuteInterval={5}
            onChange={(_, value) => {
              setPicker(Platform.OS === "ios" ? "endTime" : "");
              if (value) setEndTime(value);
            }}
          />
        )}

        <Text style={styles.label}>Motivo opcional</Text>
        <TextInput
          value={reason}
          onChangeText={setReason}
          maxLength={200}
          style={styles.input}
          placeholder="Vacaciones, almuerzo, cita médica…"
        />

        {!!selectedProfessional && (
          <Text style={styles.muted}>Solo se bloqueará la agenda de {selectedProfessional.name}.</Text>
        )}

        <Pressable disabled={busy} onPress={save} style={[styles.primary, busy && styles.disabled]}>
          <Text style={styles.primaryText}>{busy ? "Guardando…" : "Guardar bloqueo"}</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>Próximos bloqueos</Text>
          <Pressable onPress={() => load()}><Text style={styles.link}>Actualizar</Text></Pressable>
        </View>

        {closures.map(item => (
          <View key={item.id} style={styles.item}>
            <View style={styles.grow}>
              <Text style={styles.itemTitle}>
                {item.professional_name || "Todo el salón"}
              </Text>
              <Text style={styles.muted}>{closureLabel(item)}</Text>
              {!!item.reason && <Text style={styles.muted}>{item.reason}</Text>}
            </View>
            <Pressable disabled={busy} onPress={() => remove(item)} style={styles.remove}>
              <Text style={styles.removeText}>Quitar</Text>
            </Pressable>
          </View>
        ))}

        {!closures.length && !notice && (
          <Text style={styles.muted}>No hay bloqueos futuros.</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 18, paddingBottom: 44, gap: 14, backgroundColor: "#f8f5f8" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  eyebrow: { color: "#74407d", fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  title: { fontSize: 28, fontWeight: "800", color: "#2d2030" },
  link: { color: "#74407d", fontWeight: "800", paddingVertical: 4 },
  notice: { color: "#8a3048", lineHeight: 20 },
  card: { backgroundColor: "white", borderWidth: 1, borderColor: "#eadfea", borderRadius: 20, padding: 16, gap: 10 },
  sectionTitle: { fontSize: 20, fontWeight: "800", color: "#2d2030" },
  label: { color: "#3f3143", fontWeight: "700", marginTop: 3 },
  muted: { color: "#756779", lineHeight: 20 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { borderWidth: 1, borderColor: "#daceda", borderRadius: 999, paddingVertical: 8, paddingHorizontal: 11 },
  choiceSelected: { borderColor: "#74407d", backgroundColor: "#f1e7f3" },
  choiceText: { color: "#756779", fontWeight: "700" },
  choiceTextSelected: { color: "#74407d" },
  modeRow: { flexDirection: "row", gap: 8 },
  mode: { flex: 1, borderWidth: 1, borderColor: "#daceda", borderRadius: 13, paddingVertical: 11, paddingHorizontal: 10 },
  modeSelected: { borderColor: "#74407d", backgroundColor: "#f1e7f3" },
  modeText: { textAlign: "center", color: "#756779", fontWeight: "700" },
  modeTextSelected: { color: "#74407d" },
  dateButton: { borderWidth: 1, borderColor: "#daceda", borderRadius: 13, paddingVertical: 12, paddingHorizontal: 13 },
  dateValue: { color: "#2d2030", fontWeight: "800", fontSize: 16 },
  timeRow: { flexDirection: "row", gap: 10 },
  timeCol: { flex: 1, gap: 5 },
  input: { borderWidth: 1, borderColor: "#daceda", borderRadius: 13, paddingHorizontal: 13, paddingVertical: 11, fontSize: 16 },
  primary: { backgroundColor: "#74407d", borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  primaryText: { color: "white", fontWeight: "800" },
  listHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  item: { flexDirection: "row", gap: 12, alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5dce5", paddingTop: 12 },
  grow: { flex: 1 },
  itemTitle: { fontWeight: "800", color: "#2d2030", fontSize: 16 },
  remove: { borderWidth: 1, borderColor: "#a02d43", borderRadius: 12, paddingVertical: 9, paddingHorizontal: 11 },
  removeText: { color: "#a02d43", fontWeight: "800" },
  disabled: { opacity: 0.5 }
});
