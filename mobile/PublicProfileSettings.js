import React, { useEffect, useState } from "react";
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

export default function PublicProfileSettings({ token, request, logout, goBack, baseUrl }) {
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [photos, setPhotos] = useState([]);
  const [published, setPublished] = useState(false);
  const [path, setPath] = useState("");
  const [notice, setNotice] = useState("Cargando perfil…");
  const [busy, setBusy] = useState(false);

  async function load() {
    setNotice("Cargando perfil…");
    try {
      const data = await request("/api/salon/profile", { token });
      const profile = data.profile || {};
      setDescription(profile.description || "");
      setAddress(profile.address || "");
      setPhone(profile.phone || "");
      setPhotos(Array.isArray(profile.photos) ? profile.photos : []);
      setPublished(!!data.published);
      setPath(data.path || "");
      setNotice("");
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function preparePhoto(asset) {
    const context = ImageManipulator.ImageManipulator.manipulate(asset.uri);
    const width = Number(asset.width) || 0;
    const height = Number(asset.height) || 0;
    if (Math.max(width, height) > 1000) {
      if (width >= height) context.resize({ width: 1000, height: null });
      else context.resize({ width: null, height: 1000 });
    }
    const rendered = await context.renderAsync();
    for (const compress of [0.7, 0.55, 0.4, 0.3]) {
      const result = await rendered.saveAsync({
        format: ImageManipulator.SaveFormat.JPEG,
        compress,
        base64: true
      });
      if (result.base64) {
        const data = "data:image/jpeg;base64," + result.base64;
        if (data.length <= 220000) return data;
      }
    }
    throw new Error("Esta foto sigue siendo demasiado grande. Elige otra imagen.");
  }

  async function addPhoto() {
    if (busy) return;
    if (photos.length >= 3) {
      setNotice("Puedes guardar hasta 3 fotos.");
      return;
    }
    setBusy(true);
    setNotice("Preparando foto…");
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8
      });
      if (result.canceled) {
        setNotice("");
        return;
      }
      const data = await preparePhoto(result.assets[0]);
      setPhotos(current => [...current, data]);
      setNotice("Foto preparada. Pulsa Guardar perfil público para publicarla.");
    } catch (error) {
      setNotice(error.message || "No se pudo preparar la foto.");
    } finally {
      setBusy(false);
    }
  }

  function removePhoto(index) {
    if (busy) return;
    setPhotos(current => current.filter((_, i) => i !== index));
    setNotice("Foto quitada. Pulsa Guardar perfil público para confirmar.");
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setNotice("Guardando perfil público…");
    try {
      await request("/api/salon/profile", {
        token,
        method: "PUT",
        body: {
          description: description.trim(),
          address: address.trim(),
          phone: phone.trim(),
          photos
        }
      });
      setNotice("Perfil público guardado.");
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function openPublicPage() {
    if (!path) return;
    try {
      await Linking.openURL(baseUrl.replace(/\/$/, "") + path);
    } catch {
      setNotice("No se pudo abrir la página pública.");
    }
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>BellezaAI</Text>
          <Text style={styles.title}>Perfil público</Text>
        </View>
        <Pressable onPress={goBack}><Text style={styles.link}>Volver</Text></Pressable>
      </View>

      {!!notice && <Text style={styles.notice}>{notice}</Text>}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Sobre el salón</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={1200}
          style={[styles.input, styles.multiline]}
          placeholder="Cuenta qué ofrece el salón y qué lo hace especial."
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Dirección pública</Text>
        <TextInput
          value={address}
          onChangeText={setAddress}
          multiline
          maxLength={300}
          style={[styles.input, styles.address]}
          placeholder="Calle, número, ciudad y código postal"
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Teléfono público</Text>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          maxLength={30}
          style={styles.input}
          placeholder="Número para consultas"
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Fotos del salón</Text>
        <Text style={styles.muted}>{photos.length} de 3 fotos preparadas.</Text>
        <View style={styles.photoGrid}>
          {photos.map((uri, index) => (
            <View key={index + ":" + uri.slice(-18)} style={styles.photoCard}>
              <Image source={{ uri }} style={styles.photo} />
              <Pressable disabled={busy} onPress={() => removePhoto(index)} style={styles.removePhoto}>
                <Text style={styles.removePhotoText}>Quitar</Text>
              </Pressable>
            </View>
          ))}
        </View>
        {photos.length < 3 && (
          <Pressable disabled={busy} onPress={addPhoto} style={styles.secondary}>
            <Text style={styles.secondaryText}>{busy ? "Preparando…" : "Añadir foto"}</Text>
          </Pressable>
        )}
        <Text style={styles.muted}>
          BellezaAI reduce la foto antes de guardarla para que cargue más rápido en la página pública.
        </Text>
      </View>

      <Pressable disabled={busy} onPress={save} style={[styles.primary, busy && styles.disabled]}>
        <Text style={styles.primaryText}>{busy ? "Guardando…" : "Guardar perfil público"}</Text>
      </Pressable>

      {published && !!path && (
        <Pressable onPress={openPublicPage} style={styles.secondary}>
          <Text style={styles.secondaryText}>Abrir página publicada</Text>
        </Pressable>
      )}
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
  input: { borderWidth: 1, borderColor: "#daceda", borderRadius: 13, backgroundColor: "white", paddingHorizontal: 13, paddingVertical: 11, fontSize: 16 },
  multiline: { minHeight: 130, textAlignVertical: "top" },
  address: { minHeight: 90, textAlignVertical: "top" },
  muted: { color: "#756779", lineHeight: 20 },
  primary: { backgroundColor: "#74407d", borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  primaryText: { color: "white", fontWeight: "800" },
  secondary: { borderWidth: 1, borderColor: "#74407d", borderRadius: 14, paddingVertical: 13, alignItems: "center" },
  secondaryText: { color: "#74407d", fontWeight: "800" },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  photoCard: { width: "47%", gap: 6 },
  photo: { width: "100%", aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: "#eee7ee" },
  removePhoto: { alignSelf: "flex-start", borderWidth: 1, borderColor: "#a02d43", borderRadius: 10, paddingVertical: 7, paddingHorizontal: 10 },
  removePhotoText: { color: "#a02d43", fontWeight: "800" },
  disabled: { opacity: 0.5 }
});
