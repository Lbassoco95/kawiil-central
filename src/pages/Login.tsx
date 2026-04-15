import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ACTIVE_SUPABASE_HOST, supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const supabaseHost = ACTIVE_SUPABASE_HOST;

  const mapAuthErrorMessage = (message: string) => {
    const normalized = message.toLowerCase();

    if (normalized.includes("invalid login credentials")) {
      return `Correo o contraseña inválidos. Si sigues dentro en producción, revisa que esta app apunte al Supabase correcto (${supabaseHost}).`;
    }

    if (normalized.includes("email not confirmed")) {
      return "Tu correo aún no está confirmado. Revisa tu bandeja de entrada o solicita un nuevo acceso desde administración.";
    }

    if (normalized.includes("too many requests")) {
      return "Demasiados intentos de inicio de sesión. Espera unos minutos e intenta de nuevo.";
    }

    return message;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const normalizedEmail = email.trim().toLowerCase();
    const { error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error) {
      toast({
        title: "Error al iniciar sesión",
        description: mapAuthErrorMessage(error.message),
        variant: "destructive",
      });
    } else {
      navigate("/");
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-xs space-y-8">
        <div className="flex flex-col items-center gap-3">
          <img src="/images/kawiil-logo.png" alt="Kawiil" className="h-14 w-14" />
          <img src="/images/kawiil-brand-blue.png" alt="Kawiil MX" className="h-8" />
          <p className="text-xs text-muted-foreground">Plataforma de gestión interna</p>
          <p className="text-[10px] text-muted-foreground/80">Supabase: {supabaseHost}</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs text-muted-foreground">Correo electrónico</Label>
            <Input
              id="email"
              type="email"
              placeholder="tu@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9 text-sm border-border/60 bg-transparent"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs text-muted-foreground">Contraseña</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9 text-sm border-border/60 bg-transparent"
              required
            />
          </div>
          <Button type="submit" className="w-full h-9 text-sm" disabled={loading}>
            {loading ? "Ingresando..." : "Ingresar"}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default Login;
