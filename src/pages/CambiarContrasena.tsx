import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Lock } from "lucide-react";

const CambiarContrasena = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifyingLink, setVerifyingLink] = useState(false);
  const [ready, setReady] = useState(false);
  const [manualRecoveryFlow, setManualRecoveryFlow] = useState(false);
  const [activationFlow, setActivationFlow] = useState(false);
  const [activationTs, setActivationTs] = useState("");
  const [activationSig, setActivationSig] = useState("");
  const [activationMessage, setActivationMessage] = useState<string | null>(null);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace("#", ""));
    const searchParams = new URLSearchParams(window.location.search);

    const mode = searchParams.get("mode") || hashParams.get("mode");
    const token = searchParams.get("token") || hashParams.get("token");
    const email = searchParams.get("email") || hashParams.get("email");
    const ts = searchParams.get("ts") || hashParams.get("ts");
    const sig = searchParams.get("sig") || hashParams.get("sig");

    // Activation flow: el token real se genera al hacer clic en el enlace recibido
    if (mode === "activate-recovery" && email && ts && sig) {
      setActivationFlow(true);
      setRecoveryEmail(email);
      setActivationTs(ts);
      setActivationSig(sig);
      setError(null);
      return;
    }

    // Recovery flow: token/email are verified only after explicit user click
    if (mode === "recovery" && token && email) {
      setManualRecoveryFlow(true);
      setRecoveryEmail(email);
      setError(null);
      return;
    }

    const linkError = hashParams.get("error_description") || searchParams.get("error_description");
    if (linkError) {
      setError(decodeURIComponent(linkError));
      return;
    }

    // Legacy links that create session directly
    let attempts = 0;
    const maxAttempts = 90; // ~45s

    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setReady(true);
        setError(null);
        return true;
      }
      return false;
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
        setReady(true);
        setError(null);
      }
    });

    const interval = setInterval(async () => {
      const hasSession = await checkSession();
      if (hasSession) {
        clearInterval(interval);
        return;
      }

      attempts += 1;
      if (attempts >= maxAttempts) {
        clearInterval(interval);
        setError("La verificación está tardando más de lo esperado. Solicita un enlace nuevo desde administración.");
      }
    }, 500);

    checkSession();

    return () => {
      subscription.unsubscribe();
      clearInterval(interval);
    };
  }, []);

  const handleVerifyRecoveryLink = async () => {
    const token = new URLSearchParams(window.location.search).get("token") || new URLSearchParams(window.location.hash.replace("#", "")).get("token");
    if (!recoveryEmail || !token) {
      setError("Enlace de recuperación inválido. Solicita uno nuevo.");
      return;
    }

    setVerifyingLink(true);
    const { error } = await supabase.auth.verifyOtp({
      email: recoveryEmail,
      token,
      type: "recovery",
    });

    if (error) {
      setError("El enlace ha expirado o ya fue utilizado. Solicita uno nuevo desde administración.");
      setVerifyingLink(false);
      return;
    }

    window.history.replaceState({}, "", "/cambiar-contrasena");
    setManualRecoveryFlow(false);
    setReady(true);
    setError(null);
    setVerifyingLink(false);
  };

  const handleActivateRecoveryLink = async () => {
    if (!recoveryEmail || !activationTs || !activationSig) {
      setError("Enlace inválido. Solicita uno nuevo desde administración.");
      return;
    }

    setVerifyingLink(true);
    const { data, error } = await supabase.functions.invoke("activate-recovery-link", {
      body: {
        email: recoveryEmail,
        ts: activationTs,
        sig: activationSig,
        redirect_to: `${window.location.origin}/cambiar-contrasena?flow=direct`,
      },
    });

    if (error || data?.error) {
      setError(data?.error || error?.message || "No se pudo activar el enlace. Solicita uno nuevo.");
      setVerifyingLink(false);
      return;
    }

    setActivationMessage("Te enviamos un nuevo enlace de acceso a tu correo. Ábrelo para continuar con el cambio de contraseña.");
    setVerifyingLink(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 8) {
      toast({ title: "Error", description: "La contraseña debe tener al menos 8 caracteres", variant: "destructive" });
      return;
    }

    if (password !== confirmPassword) {
      toast({ title: "Error", description: "Las contraseñas no coinciden", variant: "destructive" });
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({
      password,
      data: { must_change_password: false },
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      // Mark invitation as accepted and update onboarding status
      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (userId) {
        await supabase
          .from("profiles")
          .update({ invitation_accepted: true, onboarding_status: "password_set" })
          .eq("user_id", userId);
      }
      
      toast({ title: "Contraseña actualizada", description: "Tu nueva contraseña ha sido guardada" });
      navigate("/");
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <img src="/images/kawiil-logo.png" alt="Kawiil" className="h-16 w-16" />
          <img src="/images/kawiil-brand-blue.png" alt="Kawiil MX" className="h-10" />
        </div>

        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Cambiar contraseña</CardTitle>
            </div>
            <CardDescription>
              Por seguridad, debes establecer una nueva contraseña antes de continuar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="text-center space-y-3">
                <p className="text-sm text-destructive">{error}</p>
                <Button variant="outline" onClick={() => navigate("/login")} className="w-full">
                  Ir al inicio de sesión
                </Button>
              </div>
            ) : activationFlow ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center">
                  Tu enlace está listo para activarse. Al confirmar, te enviaremos un enlace vigente para restablecer tu contraseña.
                </p>
                {activationMessage ? (
                  <p className="text-sm text-center text-primary">{activationMessage}</p>
                ) : null}
                <Button type="button" className="w-full" onClick={handleActivateRecoveryLink} disabled={verifyingLink || !!activationMessage}>
                  {verifyingLink ? "Activando enlace..." : activationMessage ? "Enlace activado" : "Activar enlace"}
                </Button>
              </div>
            ) : manualRecoveryFlow ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center">
                  Para continuar, confirma el enlace de recuperación.
                </p>
                <Button type="button" className="w-full" onClick={handleVerifyRecoveryLink} disabled={verifyingLink}>
                  {verifyingLink ? "Validando enlace..." : "Validar enlace y continuar"}
                </Button>
              </div>
            ) : !ready ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                <p className="text-sm text-muted-foreground">Verificando enlace...</p>
              </div>
            ) : (
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Nueva contraseña</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Mínimo 8 caracteres"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="Repite tu contraseña"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Guardando..." : "Guardar nueva contraseña"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CambiarContrasena;
