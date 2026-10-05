import React, { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

function Field({ label, ...props }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} {...props} />
    </View>
  );
}

export default function SalonManagement({ token, request, logout, goBack }) {
  const [services, setServices] = useState([]);
  const [team, setTeam] = useState([]);
  const [notice, setNotice] = useState("Cargando configuración…");
  const [busy, setBusy] = useState(false);

  const [editingServiceId, setEditingServiceId] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [serviceDuration, setServiceDuration] = useState("60");
  const [servicePrice, setServicePrice] = useState("");

  const [editingPersonId, setEditingPersonId] = useState("");
  const [personName, setPersonName] = useState("");
  const [personPhone, setPersonPhone] = useState("");
  const [personEmail, setPersonEmail] = useState("");
  const [personSpecialties, setPersonSpecialties] = useState("");

  async function load(message = "Actualizando…") {
    setNotice(message);
    try {
      const [serviceRows, people] = await Promise.all([
        request("/api/services?includeArchived=true", { token }),
        request("/api/professionals", { token })
      ]);
      setServices(serviceRows);
      setTeam(people);
      setNotice("");
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    }
  }

  useEffect(() => { load("Cargando configuración…"); }, []);

  function resetServiceForm() {
    setEditingServiceId("");
    setServiceName("");
    setServiceDuration("60");
    setServicePrice("");
  }

  function editService(service) {
    if (!service.active || busy) return;
    setEditingServiceId(service.id);
    setServiceName(service.name || "");
    setServiceDuration(String(service.duration_minutes || 60));
    setServicePrice(service.price_label || "");
    setNotice("Editando " + service.name + ".");
  }

  async function saveService() {
    if (busy) return;
    const duration = Number(serviceDuration);
    if (!serviceName.trim() || !Number.isInteger(duration) || duration < 1 || duration > 1440) {
      setNotice("Revisa el nombre y la duración del servicio.");
      return;
    }

    setBusy(true);
    setNotice(editingServiceId ? "Actualizando servicio…" : "Guardando servicio…");
    try {
      await request(
        editingServiceId
          ? "/api/services/" + encodeURIComponent(editingServiceId)
          : "/api/services",
        {
          token,
          method: editingServiceId ? "PATCH" : "POST",
          body: {
            name: serviceName.trim(),
            duration_minutes: duration,
            price_label: servicePrice.trim()
          }
        }
      );
      const edited = !!editingServiceId;
      resetServiceForm();
      await load("Actualizando servicios…");
      setNotice(edited ? "Servicio actualizado." : "Servicio guardado.");
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleService(service) {
    if (busy) return;
    setBusy(true);
    setNotice(service.active ? "Archivando servicio…" : "Activando servicio…");
    try {
      await request("/api/services/" + encodeURIComponent(service.id) + "/availability", {
        token,
        method: "PATCH",
        body: { active: !service.active }
      });
      if (editingServiceId === service.id) resetServiceForm();
      await load();
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  function resetPersonForm() {
    setEditingPersonId("");
    setPersonName("");
    setPersonPhone("");
    setPersonEmail("");
    setPersonSpecialties("");
  }

  function editPerson(person) {
    if (busy) return;
    setEditingPersonId(person.id);
    setPersonName(person.name || "");
    setPersonPhone(person.phone || "");
    setPersonEmail(person.email || "");
    setPersonSpecialties((person.specialties || []).join(", "));
    setNotice("Editando " + person.name + ".");
  }

  async function savePerson() {
    if (busy) return;
    if (!personName.trim()) {
      setNotice("Escribe el nombre del profesional.");
      return;
    }

    const specialties = personSpecialties
      .split(",")
      .map(value => value.trim())
      .filter(Boolean);

    setBusy(true);
    setNotice(editingPersonId ? "Actualizando profesional…" : "Guardando profesional…");
    try {
      await request(
        editingPersonId
          ? "/api/professionals/" + encodeURIComponent(editingPersonId)
          : "/api/professionals",
        {
          token,
          method: editingPersonId ? "PATCH" : "POST",
          body: editingPersonId
            ? {
                name: personName.trim(),
                phone: personPhone.trim(),
                email: personEmail.trim()
              }
            : {
                name: personName.trim(),
                phone: personPhone.trim(),
                email: personEmail.trim(),
                specialties
              }
        }
      );

      const edited = !!editingPersonId;
      resetPersonForm();
      await load("Actualizando equipo…");
      setNotice(edited ? "Profesional actualizado." : "Profesional guardado.");
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
          <Text style={styles.title}>Servicios y equipo</Text>
        </View>
        <Pressable onPress={goBack}><Text style={styles.link}>Volver</Text></Pressable>
      </View>

      {!!notice && <Text style={styles.notice}>{notice}</Text>}

      <View style={styles.card}>
        <View style={styles.formHeader}>
          <Text style={styles.sectionTitle}>
            {editingServiceId ? "Editar servicio" : "Nuevo servicio"}
          </Text>
          {!!editingServiceId && (
            <Pressable disabled={busy} onPress={resetServiceForm}>
              <Text style={styles.link}>Cancelar edición</Text>
            </Pressable>
          )}
        </View>
        <Field label="Nombre" value={serviceName} onChangeText={setServiceName} maxLength={120} placeholder="Ej. Cambio de color" />
        <Field label="Duración en minutos" value={serviceDuration} onChangeText={setServiceDuration} keyboardType="number-pad" placeholder="60" />
        <Field label="Precio mostrado" value={servicePrice} onChangeText={setServicePrice} maxLength={100} placeholder="Ej. $85 o Desde $85" />
        <Pressable disabled={busy} onPress={saveService} style={[styles.primary, busy && styles.disabled]}>
          <Text style={styles.primaryText}>
            {editingServiceId ? "Guardar cambios" : "Guardar servicio"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Servicios</Text>
        {services.map(service => (
          <View key={service.id} style={styles.item}>
            <View style={styles.grow}>
              <Text style={styles.itemTitle}>{service.name}</Text>
              <Text style={styles.muted}>
                {service.duration_minutes} min{service.price_label ? " · " + service.price_label : ""}
              </Text>
              <Text style={service.active ? styles.active : styles.archived}>
                {service.active ? "Activo" : "Archivado"}
              </Text>
            </View>
            <View style={styles.actions}>
              {service.active && (
                <Pressable disabled={busy} onPress={() => editService(service)} style={styles.secondary}>
                  <Text style={styles.secondaryText}>Editar</Text>
                </Pressable>
              )}
              <Pressable disabled={busy} onPress={() => toggleService(service)} style={styles.secondary}>
                <Text style={styles.secondaryText}>{service.active ? "Archivar" : "Activar"}</Text>
              </Pressable>
            </View>
          </View>
        ))}
        {!services.length && !notice && <Text style={styles.muted}>No hay servicios.</Text>}
      </View>

      <View style={styles.card}>
        <View style={styles.formHeader}>
          <Text style={styles.sectionTitle}>
            {editingPersonId ? "Editar profesional" : "Nuevo profesional"}
          </Text>
          {!!editingPersonId && (
            <Pressable disabled={busy} onPress={resetPersonForm}>
              <Text style={styles.link}>Cancelar edición</Text>
            </Pressable>
          )}
        </View>
        <Field label="Nombre" value={personName} onChangeText={setPersonName} maxLength={120} placeholder="Nombre" />
        <Field label="Teléfono" value={personPhone} onChangeText={setPersonPhone} maxLength={60} keyboardType="phone-pad" placeholder="Teléfono" />
        <Field label="Correo" value={personEmail} onChangeText={setPersonEmail} maxLength={254} autoCapitalize="none" keyboardType="email-address" placeholder="Correo opcional" />
        {!editingPersonId ? (
          <>
            <Field label="Especialidades" value={personSpecialties} onChangeText={setPersonSpecialties} maxLength={300} placeholder="Uñas, color, pestañas" />
            <Text style={styles.muted}>Separa las especialidades con comas.</Text>
          </>
        ) : (
          <Text style={styles.muted}>
            Las especialidades actuales se conservan. Esta edición cambia nombre, teléfono y correo.
          </Text>
        )}
        <Pressable disabled={busy} onPress={savePerson} style={[styles.primary, busy && styles.disabled]}>
          <Text style={styles.primaryText}>
            {editingPersonId ? "Guardar cambios" : "Guardar profesional"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Equipo</Text>
        {team.map(person => (
          <View key={person.id} style={styles.item}>
            <View style={styles.grow}>
              <Text style={styles.itemTitle}>{person.name}</Text>
              {!!person.phone && <Text style={styles.muted}>{person.phone}</Text>}
              {!!person.email && <Text style={styles.muted}>{person.email}</Text>}
              {!!person.specialties?.length && (
                <Text style={styles.muted}>{person.specialties.join(" · ")}</Text>
              )}
            </View>
            <Pressable disabled={busy} onPress={() => editPerson(person)} style={styles.secondary}>
              <Text style={styles.secondaryText}>Editar</Text>
            </Pressable>
          </View>
        ))}
        {!team.length && !notice && <Text style={styles.muted}>Todavía no hay profesionales.</Text>}
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
  formHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  sectionTitle: { fontSize: 20, fontWeight: "800", color: "#2d2030" },
  field: { gap: 5 },
  label: { fontWeight: "700", color: "#3f3143" },
  input: { borderWidth: 1, borderColor: "#daceda", borderRadius: 13, backgroundColor: "white", paddingHorizontal: 13, paddingVertical: 11, fontSize: 16 },
  primary: { backgroundColor: "#74407d", borderRadius: 14, paddingVertical: 13, alignItems: "center" },
  primaryText: { color: "white", fontWeight: "800" },
  secondary: { borderWidth: 1, borderColor: "#74407d", borderRadius: 12, paddingVertical: 9, paddingHorizontal: 11 },
  secondaryText: { color: "#74407d", fontWeight: "800" },
  item: { flexDirection: "row", gap: 12, alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5dce5", paddingTop: 12 },
  grow: { flex: 1 },
  actions: { gap: 7, alignItems: "stretch" },
  itemTitle: { fontWeight: "800", color: "#2d2030", fontSize: 16 },
  muted: { color: "#756779", lineHeight: 20 },
  active: { color: "#3c6b4f", fontWeight: "700", marginTop: 3 },
  archived: { color: "#8a3048", fontWeight: "700", marginTop: 3 },
  disabled: { opacity: 0.5 }
});
