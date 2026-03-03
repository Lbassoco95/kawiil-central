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
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    // Listen for PASSWORD_RECOVERY or SIGNED_IN events from the recovery link
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
          if (session) {
            setReady(true);
            setError(null);
          }
        }
      }
    );

    // Also check if user already has a session (e.g. navigated manually)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setReady(true);
      }
    });

    // Timeout: if after 10s no session, show error
    const timeout = setTimeout(() => {
      setReady((prev) => {
        if (!prev) {
          setError("El enlace ha expirado o es inválido. Solicita uno nuevo desde el administrador.");
        }
        return prev;
      });
    }, 10000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

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
