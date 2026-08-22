import { api } from "$convex/_generated/api";
import type { SignInResult } from "@estifanos-sh/convex-auth/client";
import { useQuery } from "convex/react";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut } from "react-native-reanimated";

import { useDemoAuth } from "./auth";
import { useAppClient } from "./client";
import { colors, spacing, fontSize, radius, shadows } from "./theme";

function useAuthForm() {
  const { auth, signIn } = useDemoAuth();
  const client = useAppClient();
  const [isSubmitting, setIsSubmitting] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [step, setStep] = React.useState<"email" | "password">("email");
  const [mode, setMode] = React.useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const passkeyClient = auth.webauthn;

  const submit = React.useCallback(
    async (label: string, operation: () => Promise<SignInResult>) => {
      setIsSubmitting(label);
      setError(null);
      try {
        const result = await operation();
        if (result.kind !== "signedIn" && result.kind !== "redirect") {
          setError("Authentication did not complete.");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Sign-in failed.");
      } finally {
        setIsSubmitting(null);
      }
    },
    [],
  );

  const handleEmailContinue = React.useCallback(async () => {
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setIsSubmitting("email");
    setError(null);
    try {
      try {
        const ssoInfo = await client.query(api.auth.group.signInLookup, {
          email: normalized,
        });
        if (!ssoInfo) throw new Error("No group connection matched the provided input.");
        await signIn("connection", { connectionId: ssoInfo.connectionId });
        return;
      } catch (ssoError) {
        if (!(ssoError instanceof Error) || !ssoError.message.includes("No group connection"))
          throw ssoError;
      }
      const exists = await client.query(api.groups.emailExists, { email: normalized });
      setMode(exists ? "signIn" : "signUp");
      setStep("password");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setIsSubmitting(null);
    }
  }, [client, email, signIn]);

  const handlePasswordSubmit = React.useCallback(async () => {
    if (!email.trim().includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (!password.trim()) {
      setError("Enter your password.");
      return;
    }
    await submit("password", () =>
      signIn("password", { flow: mode, email: email.trim().toLowerCase(), password }),
    );
  }, [email, mode, password, signIn, submit]);

  return {
    isSubmitting,
    error,
    step,
    setStep,
    mode,
    email,
    setEmail,
    password,
    setPassword,
    passkeySupported: passkeyClient.isSupported(),
    handleSignIn: (provider: "google" | "anonymous") => submit(provider, () => signIn(provider)),
    handleEmailContinue,
    handlePasswordSubmit,
    handlePasskey: React.useCallback(async () => {
      setIsSubmitting("passkey");
      setError(null);
      try {
        const result = await passkeyClient.signIn();
        if (result.kind !== "signedIn") setError("Passkey sign-in did not complete.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Passkey sign-in failed.");
      } finally {
        setIsSubmitting(null);
      }
    }, [passkeyClient]),
  };
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { state } = useDemoAuth();
  const authProviders = useQuery(api.groups.authProviders, {});
  const form = useAuthForm();

  if (state.status === "loading" || authProviders === undefined) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.warm[50],
        }}
      >
        <ActivityIndicator color={colors.accent[500]} />
      </View>
    );
  }

  if (state.status === "signedIn") return <>{children}</>;

  return (
    <View style={{ flex: 1, backgroundColor: colors.warm[50] }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingHorizontal: spacing["2xl"],
          paddingVertical: spacing["3xl"],
          gap: spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View
          entering={FadeInDown.duration(500).springify()}
          style={{ maxWidth: 420, alignSelf: "center", gap: spacing.sm }}
        >
          <Text
            selectable
            style={{
              fontSize: 11,
              fontWeight: "700",
              letterSpacing: 1.6,
              textTransform: "uppercase",
              color: colors.warm[400],
            }}
          >
            convex-auth
          </Text>
          <Text
            selectable
            style={{ fontSize: 38, lineHeight: 42, fontWeight: "700", color: colors.warm[900] }}
          >
            Sign in
          </Text>
          <Text
            selectable
            style={{
              fontSize: fontSize.xl,
              lineHeight: 26,
              color: colors.warm[600],
              maxWidth: 340,
            }}
          >
            Pick the fastest way back into the demo.
          </Text>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.delay(100).duration(500).springify()}
          style={{
            width: "100%",
            maxWidth: 420,
            alignSelf: "center",
            gap: spacing.xl,
            padding: spacing["2xl"],
            borderRadius: spacing["2xl"],
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: colors.warm[300],
            backgroundColor: colors.white,
            boxShadow: shadows.md.boxShadow,
          }}
        >
          <View style={{ gap: spacing.md }}>
            <Text
              style={{
                fontSize: fontSize.sm,
                color: colors.warm[500],
                fontWeight: "700",
                textTransform: "uppercase",
                letterSpacing: 1.2,
              }}
            >
              Email
            </Text>

            {form.step === "email" ? (
              <Animated.View entering={FadeIn.duration(200)} style={{ gap: spacing.md }}>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  onChangeText={form.setEmail}
                  placeholder="you@company.com"
                  placeholderTextColor={colors.warm[400]}
                  style={{
                    minHeight: 52,
                    borderRadius: radius.lg,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: colors.warm[300],
                    backgroundColor: colors.warm[50],
                    paddingHorizontal: spacing.lg,
                    color: colors.warm[900],
                    fontSize: fontSize.lg,
                  }}
                  value={form.email}
                />
                <Pressable
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    void form.handleEmailContinue();
                  }}
                  disabled={form.isSubmitting !== null}
                  style={({ pressed }) => ({
                    minHeight: 52,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: radius.lg,
                    borderCurve: "continuous",
                    backgroundColor: pressed ? colors.accent[600] : colors.accent[500],
                    boxShadow: shadows.accent.boxShadow,
                  })}
                >
                  {form.isSubmitting === "email" ? (
                    <ActivityIndicator color={colors.content.primary} size="small" />
                  ) : (
                    <Text
                      style={{
                        color: colors.content.primary,
                        fontSize: fontSize.lg,
                        fontWeight: "700",
                      }}
                    >
                      Continue with email
                    </Text>
                  )}
                </Pressable>
              </Animated.View>
            ) : (
              <Animated.View
                entering={FadeIn.duration(200)}
                exiting={FadeOut.duration(150)}
                style={{ gap: spacing.md }}
              >
                <View
                  style={{
                    alignSelf: "flex-start",
                    borderRadius: radius.full,
                    paddingHorizontal: spacing.sm + 2,
                    paddingVertical: spacing.xs + 2,
                    backgroundColor: colors.warm[100],
                  }}
                >
                  <Text
                    style={{ fontSize: fontSize.sm, color: colors.warm[700], fontWeight: "700" }}
                  >
                    {form.mode === "signIn" ? "Password sign in" : "Create account"}
                  </Text>
                </View>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  onChangeText={form.setEmail}
                  placeholder="you@company.com"
                  placeholderTextColor={colors.warm[400]}
                  style={{
                    minHeight: 52,
                    borderRadius: radius.lg,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: colors.warm[300],
                    backgroundColor: colors.warm[50],
                    paddingHorizontal: spacing.lg,
                    color: colors.warm[900],
                    fontSize: fontSize.lg,
                  }}
                  value={form.email}
                />
                <TextInput
                  autoCapitalize="none"
                  autoComplete="password"
                  onChangeText={form.setPassword}
                  placeholder="Password"
                  placeholderTextColor={colors.warm[400]}
                  secureTextEntry
                  style={{
                    minHeight: 52,
                    borderRadius: radius.lg,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: colors.warm[300],
                    backgroundColor: colors.warm[50],
                    paddingHorizontal: spacing.lg,
                    color: colors.warm[900],
                    fontSize: fontSize.lg,
                  }}
                  value={form.password}
                />
                <Pressable
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    void form.handlePasswordSubmit();
                  }}
                  disabled={form.isSubmitting !== null}
                  style={({ pressed }) => ({
                    minHeight: 52,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: radius.lg,
                    borderCurve: "continuous",
                    backgroundColor: pressed ? colors.accent[600] : colors.accent[500],
                    boxShadow: shadows.accent.boxShadow,
                  })}
                >
                  {form.isSubmitting === "password" ? (
                    <ActivityIndicator color={colors.content.primary} size="small" />
                  ) : (
                    <Text
                      style={{
                        color: colors.content.primary,
                        fontSize: fontSize.lg,
                        fontWeight: "700",
                      }}
                    >
                      {form.mode === "signIn" ? "Sign in" : "Create account"}
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => form.setStep("email")}
                  style={{ alignItems: "center", minHeight: 28 }}
                >
                  <Text
                    style={{ color: colors.warm[600], fontSize: fontSize.sm, fontWeight: "600" }}
                  >
                    Use a different email
                  </Text>
                </Pressable>
              </Animated.View>
            )}
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm + 2 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.warm[200] }} />
            <Text
              style={{
                fontSize: fontSize.xs,
                color: colors.warm[400],
                fontWeight: "700",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              or
            </Text>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.warm[200] }} />
          </View>

          <View style={{ gap: spacing.sm + 2 }}>
            {authProviders.google && (
              <Pressable
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  void form.handleSignIn("google");
                }}
                disabled={form.isSubmitting !== null}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  minHeight: 50,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: spacing.sm,
                  borderRadius: radius.lg,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: colors.warm[300],
                  backgroundColor: pressed ? colors.warm[100] : colors.white,
                })}
              >
                {form.isSubmitting === "google" ? (
                  <ActivityIndicator color={colors.warm[500]} size="small" />
                ) : (
                  <>
                    <Image
                      source="sf:globe"
                      style={{ width: 18, height: 18 }}
                      tintColor={colors.warm[700]}
                    />
                    <Text
                      style={{ color: colors.warm[900], fontSize: fontSize.lg, fontWeight: "600" }}
                    >
                      Continue with Google
                    </Text>
                  </>
                )}
              </Pressable>
            )}

            {form.passkeySupported && (
              <Pressable
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  void form.handlePasskey();
                }}
                disabled={form.isSubmitting !== null}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  minHeight: 50,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: spacing.sm,
                  borderRadius: radius.lg,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: colors.warm[300],
                  backgroundColor: pressed ? colors.warm[100] : colors.white,
                })}
              >
                {form.isSubmitting === "passkey" ? (
                  <ActivityIndicator color={colors.warm[500]} size="small" />
                ) : (
                  <>
                    <Image
                      source="sf:person.badge.key"
                      style={{ width: 18, height: 18 }}
                      tintColor={colors.warm[700]}
                    />
                    <Text
                      style={{ color: colors.warm[900], fontSize: fontSize.lg, fontWeight: "600" }}
                    >
                      Continue with Passkey
                    </Text>
                  </>
                )}
              </Pressable>
            )}

            <Pressable
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                void form.handleSignIn("anonymous");
              }}
              disabled={form.isSubmitting !== null}
              style={({ pressed }) => ({
                alignItems: "center",
                justifyContent: "center",
                minHeight: 42,
                borderRadius: radius.md,
                borderCurve: "continuous",
                backgroundColor: pressed ? colors.warm[200] : colors.warm[100],
              })}
            >
              {form.isSubmitting === "anonymous" ? (
                <ActivityIndicator color={colors.warm[500]} size="small" />
              ) : (
                <Text style={{ color: colors.warm[600], fontSize: fontSize.md, fontWeight: "600" }}>
                  Continue as guest
                </Text>
              )}
            </Pressable>
          </View>

          {form.error && (
            <Animated.View
              entering={FadeIn.duration(200)}
              style={{ flexDirection: "row", gap: spacing.xs, alignItems: "center" }}
            >
              <Image
                source="sf:exclamationmark.triangle.fill"
                style={{ width: 14, height: 14 }}
                tintColor={colors.urgent}
              />
              <Text selectable style={{ fontSize: fontSize.sm, color: colors.urgent, flex: 1 }}>
                {form.error}
              </Text>
            </Animated.View>
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
}
