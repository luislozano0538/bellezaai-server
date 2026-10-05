import React, { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

export default function AssistantScreen({ token, request, logout }) {
  const [messages, setMessages] = useState([
    {
      id: "welcome",
      role: "assistant",
      text: "Hola. Soy BellezaAI. Puedo ayudarte con servicios, precios registrados y atención al cliente del salón."
    }
  ]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const scroll = useRef(null);

  async function send() {
    const message = text.trim();
    if (!message || busy) return;

    const mine = { id: "u-" + Date.now(), role: "user", text: message };
    setMessages(current => [...current, mine]);
    setText("");
    setBusy(true);
    setNotice("");

    try {
      const result = await request("/api/chat", {
        token,
        method: "POST",
        body: { message }
      });
      setMessages(current => [
        ...current,
        {
          id: "a-" + Date.now(),
          role: "assistant",
          text: result.reply || "No recibí una respuesta."
        }
      ]);
    } catch (error) {
      if (error.status === 401) return logout();
      setNotice(error.message);
    } finally {
      setBusy(false);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 10 : 0}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>BellezaAI</Text>
          <Text style={styles.title}>Asistente IA</Text>
        </View>
        <Pressable
          onPress={() => {
            setMessages([{
              id: "welcome-" + Date.now(),
              role: "assistant",
              text: "Conversación nueva. ¿En qué te ayudo con el salón?"
            }]);
            setNotice("");
          }}
        >
          <Text style={styles.link}>Nueva</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scroll}
        style={styles.flex}
        contentContainerStyle={styles.messages}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        {messages.map(message => (
          <View
            key={message.id}
            style={[
              styles.bubble,
              message.role === "user" ? styles.userBubble : styles.aiBubble
            ]}
          >
            <Text style={[
              styles.bubbleText,
              message.role === "user" && styles.userText
            ]}>
              {message.text}
            </Text>
          </View>
        ))}
        {busy && (
          <View style={[styles.bubble, styles.aiBubble]}>
            <Text style={styles.muted}>Pensando…</Text>
          </View>
        )}
        {!!notice && <Text style={styles.notice}>{notice}</Text>}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Escribe un mensaje…"
          multiline
          maxLength={1200}
          style={styles.input}
          onSubmitEditing={() => {
            if (Platform.OS !== "ios") send();
          }}
        />
        <Pressable
          disabled={!text.trim() || busy}
          onPress={send}
          style={[styles.send, (!text.trim() || busy) && styles.disabled]}
        >
          <Text style={styles.sendText}>Enviar</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#f8f5f8" },
  header: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between"
  },
  eyebrow: {
    color: "#74407d",
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1
  },
  title: { fontSize: 28, fontWeight: "800", color: "#2d2030" },
  link: { color: "#74407d", fontWeight: "800", paddingVertical: 4 },
  messages: { padding: 18, gap: 10, paddingBottom: 24 },
  bubble: {
    maxWidth: "88%",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 11
  },
  aiBubble: {
    alignSelf: "flex-start",
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#eadfea"
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: "#74407d"
  },
  bubbleText: { color: "#35283a", fontSize: 16, lineHeight: 22 },
  userText: { color: "white" },
  muted: { color: "#756779" },
  notice: { color: "#8a3048", lineHeight: 20 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#ded4de",
    backgroundColor: "white"
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: "#daceda",
    borderRadius: 15,
    paddingHorizontal: 13,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: "#fff"
  },
  send: {
    backgroundColor: "#74407d",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13
  },
  sendText: { color: "white", fontWeight: "800" },
  disabled: { opacity: 0.45 }
});
