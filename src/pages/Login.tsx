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

  const isInvalidCredentialsMessage = (message: string) => {
    const n = message.toLowerCase();
    return n.includes("invalid login credentials") || n.includes("invalid email or password");
  };

  const mapAuthErrorMessage = (message: string) => {
    const normalized = message.toLowerCase();

    if (isInvalidCredentialsMessage(message)) {
      return "Correo o contraseña incorrectos. Revisa mayúsculas y espacios. Si no recuerdas tu contraseña, pide al administrador el correo para restablecerla.";
    }

    if (normalized.includes("email not confirmed")) {
      return "Tu correo aún no está confirmado. Revisa tu bandeja (y spam) o pide a administración que reenvíe la invitación o el acceso.";
    }

    if (
      normalized.includes("too many requests") ||
      normalized.includes("rate limit") ||
      normalized.includes("email rate limit")
    ) {
      return "Demasiados intentos de inicio de sesión. Espera unos minutos e intenta de nuevo.";
    }

    if (normalized.includes("user is banned") || normalized.includes("banned")) {
      return "Esta cuenta está deshabilitada. Contacta a administración.";
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
        title: isInvalidCredentialsMessage(error.message)
          ? "No pudimos validar tu acceso"
          : "Error al iniciar sesión",
        description: mapAuthErrorMessage(error.message),
        variant: "destructive",
      });
    } else {
      navigate("/");
    }
    setLoading(false);
  };

  return (
    <div className="grid min-h-screen grid-cols-1 bg-background lg:grid-cols-2">
      {/* Form column */}
      <div className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm space-y-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <img src="/images/kawiil-logo.png" alt="Kawiil" className="h-14 w-14" />
            <img src="/images/kawiil-brand-blue.png" alt="Kawiil MX" className="h-8" />
            <div>
              <h1 className="text-base font-semibold tracking-tight gradient-text">
                Bienvenido a Kawiil OS
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Plataforma de gestión interna
              </p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs text-muted-foreground">
                Correo electrónico
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="tu@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10 text-sm border-border/60 bg-background/60"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs text-muted-foreground">
                Contraseña
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10 text-sm border-border/60 bg-background/60"
                required
              />
            </div>
            <Button type="submit" className="w-full h-10 text-sm" disabled={loading}>
              {loading ? "Ingresando..." : "Ingresar"}
            </Button>
          </form>

          <p className="text-center text-[10px] text-muted-foreground/70">
            Supabase: {supabaseHost}
          </p>
        </div>
      </div>

      {/* Hero column */}
      <div
        className="relative hidden overflow-hidden lg:block"
        style={{
          background:
            "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 100%)",
        }}
        aria-hidden
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 top-12 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -right-20 bottom-10 h-96 w-96 rounded-full bg-white/15 blur-3xl" />
          <div className="absolute right-24 top-32 h-32 w-32 rounded-full border border-white/30" />
          <div className="absolute left-16 bottom-32 h-48 w-48 rounded-full border border-white/20" />
        </div>

        <div className="relative z-10 flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <img src="/images/kawiil-logo.png" alt="" className="h-9 w-9 brightness-0 invert" />
            <span className="text-sm font-semibold tracking-wide">Kawiil OS</span>
          </div>

          <div className="space-y-6">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/70">
                Plataforma interna
              </p>
              <h2 className="mt-3 text-4xl font-bold leading-tight tracking-tight">
                La contabilidad nunca fue tan fácil.
              </h2>
              <p className="mt-3 max-w-md text-sm text-white/80">
                Tareas, proyectos y clientes en un solo lugar. Con Kawiil AI para que el equipo decida más rápido y sin perder contexto.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 max-w-md">
              {[
                { k: "Tareas", v: "Tablero por célula" },
                { k: "Proyectos", v: "Gestoría · Constitución · Juicios" },
                { k: "IA", v: "Resúmenes y artefactos" },
              ].map((item) => (
                <div
                  key={item.k}
                  className="rounded-xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
                    {item.k}
                  </p>
                  <p className="mt-1 text-xs text-white/90">{item.v}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[11px] text-white/60">
            © {new Date().getFullYear()} Kawiil MX · Diseñado para tu equipo.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
