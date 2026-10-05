import React, { useEffect, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

const DAY_NAMES = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const DEFAULT_DAYS = DAY_NAMES.map((_, index) => ({
  open: index !== 0,
  start: "09:00",
  end: "18:00"
}));

export default function SalonSettings({ token, request, logout, goBack, baseUrl }) {
  const [salonName, setSalonName] = useState("");
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"
  );
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [booking, setBooking] = useState({ enabled: false, ready: false, path: "" });
  const [notice, setNotice] = useState("Cargando ajustes…");
  const [busy, setBusy] = useState(false);

  async function load(message = "Actualizando…") {
    setNotice(message);
    try {
      const [salon, hoursResult, publicResult] = await Promise.all([
        request("/api/salon", { token }),
        request("/api/salon/hours", { token }),
        request("/api/salon/public-booking", { token })
      ]);
      setSalonName(salon?.name || "");
      if (hoursResult?.hours) {
        setTimezone(hoursResult.hours.timezone);
        setDays(hoursResult.hours.days.map(day =>
          day.open
            ? { open: true, start: day.start, end: day.end }
            : { open: false, start: "09:00", end: "18:00" }
        ));
      }
      setBooking(publicResult);
      setNotice("");
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    }
  }

  useEffect(() => { load("Cargando ajustes…"); }, []);

  function updateDay(index, patch) {
    setDays(current => current.map((day, i) => i === index ? { ...day, ...patch } : day));
  }

  function validTime(value) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  async function saveSalonName() {
    if (busy) return;
    if (!salonName.trim()) {
      setNotice("Escribe el nombre del salón.");
      return;
    }
    setBusy(true);
    setNotice("Guardando nombre…");
    try {
      const result = await request("/api/salon", {
        token,
        method: "PATCH",
        body: { name: salonName.trim() }
      });
      setSalonName(result.name);
      setNotice("Nombre del salón guardado.");
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveHours() {
    if (busy) return;
    const invalid = days.some(day =>
      day.open && (!validTime(day.start) || !validTime(day.end) || day.start >= day.end)
    );
    if (!timezone.trim() || invalid) {
      setNotice("Revisa la zona horaria y las horas de apertura y cierre.");
      return;
    }

    setBusy(true);
    setNotice("Guardando horario…");
    try {
      const result = await request("/api/salon/hours", {
        token,
        method: "PATCH",
        body: {
          timezone: timezone.trim(),
          days: days.map(day =>
            day.open
              ? { open: true, start: day.start, end: day.end }
              : { open: false }
          )
        }
      });
      setTimezone(result.hours.timezone);
      setDays(result.hours.days.map(day =>
        day.open
          ? { open: true, start: day.start, end: day.end }
          : { open: false, start: "09:00", end: "18:00" }
      ));
      setNotice("Horario guardado.");
      const fresh = await request("/api/salon/public-booking", { token });
      setBooking(fresh);
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleBooking() {
    if (busy) return;
    setBusy(true);
    setNotice(booking.enabled ? "Desactivando reservas…" : "Activando reservas…");
    try {
      const result = await request("/api/salon/public-booking", {
        token,
        method: "PATCH",
        body: { enabled: !booking.enabled }
      });
      setBooking(current => ({ ...current, enabled: result.enabled }));
      setNotice(result.enabled ? "Reservas en línea activadas." : "Reservas en línea desactivadas.");
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function openBookingPage() {
    if (!booking.path) return;
    const url = baseUrl.replace(/\/$/, "") + booking.path;
    try {
      await Linking.openURL(url);
    } catch {
      setNotice("No se pudo abrir la página pública.");
    }
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>BellezaAI</Text>
          <Text style={styles.title}>Horario y reservas</Text>
        </View>
        <Pressable onPress={goBack}><Text style={styles.link}>Volver</Text></Pressable>
      </View>

      {!!notice && <Text style={styles.notice}>{notice}</Text>}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Nombre del salón</Text>
        <TextInput
          value={salonName}
          onChangeText={setSalonName}
          maxLength={120}
          style={styles.input}
          placeholder="Nombre del negocio"
        />
        <Pressable disabled={busy} onPress={saveSalonName} style={[styles.primary, busy && styles.disabled]}>
          <Text style={styles.primaryText}>Guardar nombre</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Zona horaria</Text>
        <TextInput
          value={timezone}
          onChangeText={setTimezone}
          autoCapitalize="none"
          style={styles.input}
          placeholder="America/New_York"
        />
        <Text style={styles.muted}>Se usa para mostrar y validar todas las horas del salón.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Horario semanal</Text>
        {days.map((day, index) => (
          <View key={DAY_NAMES[index]} style={styles.day}>
            <View style={styles.dayTop}>
              <Text style={styles.dayName}>{DAY_NAMES[index]}</Text>
              <Pressable
                onPress={() => updateDay(index, { open: !day.open })}
                style={[styles.toggle, day.open && styles.toggleOn]}
              >
                <Text style={[styles.toggleText, day.open && styles.toggleTextOn]}>
                  {day.open ? "Abierto" : "Cerrado"}
                </Text>
              </Pressable>
            </View>
            {day.open && (
              <View style={styles.timeRow}>
                <View style={styles.timeField}>
                  <Text style={styles.smallLabel}>Abre</Text>
                  <TextInput
                    value={day.start}
                    onChangeText={value => updateDay(index, { start: value })}
                    style={styles.timeInput}
                    placeholder="09:00"
                    maxLength={5}
                  />
                </View>
                <View style={styles.timeField}>
                  <Text style={styles.smallLabel}>Cierra</Text>
                  <TextInput
                    value={day.end}
                    onChangeText={value => updateDay(index, { end: value })}
                    style={styles.timeInput}
                    placeholder="18:00"
                    maxLength={5}
                  />
                </View>
              </View>
            )}
          </View>
        ))}
        <Pressable disabled={busy} onPress={saveHours} style={[styles.primary, busy && styles.disabled]}>
          <Text style={styles.primaryText}>Guardar horario</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Reservas en línea</Text>
        <Text style={styles.muted}>
          {booking.enabled
            ? "La página pública está activa y los clientes pueden reservar."
            : booking.ready
              ? "El horario está listo. Puedes activar la página pública."
              : "Completa un horario válido y al menos un servicio activo antes de publicar."}
        </Text>
        <Pressable disabled={busy} onPress={toggleBooking} style={[styles.primary, busy && styles.disabled]}>
          <Text style={styles.primaryText}>
            {booking.enabled ? "Desactivar reservas públicas" : "Activar reservas públicas"}
          </Text>
        </Pressable>
        {booking.enabled && !!booking.path && (
          <Pressable onPress={openBookingPage} style={styles.secondary}>
            <Text style={styles.secondaryText}>Abrir página de reservas</Text>
          </Pressable>
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
  input: { borderWidth: 1, borderColor: "#daceda", borderRadius: 13, backgroundColor: "white", paddingHorizontal: 13, paddingVertical: 11, fontSize: 16 },
  muted: { color: "#756779", lineHeight: 20 },
  primary: { backgroundColor: "#74407d", borderRadius: 14, paddingVertical: 13, alignItems: "center" },
  primaryText: { color: "white", fontWeight: "800" },
  secondary: { borderWidth: 1, borderColor: "#74407d", borderRadius: 14, paddingVertical: 12, alignItems: "center" },
  secondaryText: { color: "#74407d", fontWeight: "800" },
  day: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5dce5", paddingTop: 12, gap: 9 },
  dayTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  dayName: { fontWeight: "800", color: "#2d2030", fontSize: 16 },
  toggle: { borderWidth: 1, borderColor: "#b7aab8", borderRadius: 999, paddingVertical: 7, paddingHorizontal: 11 },
  toggleOn: { backgroundColor: "#efe3f2", borderColor: "#74407d" },
  toggleText: { color: "#756779", fontWeight: "700" },
  toggleTextOn: { color: "#74407d" },
  timeRow: { flexDirection: "row", gap: 10 },
  timeField: { flex: 1, gap: 4 },
  smallLabel: { color: "#756779", fontSize: 12, fontWeight: "700" },
  timeInput: { borderWidth: 1, borderColor: "#daceda", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  disabled: { opacity: 0.5 }
});
