import { Component, type ErrorInfo, type ReactNode } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Error Boundary local para el picker de plantillas contables. Si el subárbol
 * lanza una excepción (por una query rota, una sesión expirada, etc.) NO
 * desaparece el slot completo: dejamos un botón "Plantillas contables"
 * deshabilitado con un tooltip que indica al usuario recargar.
 *
 * Antes de este boundary, una excepción en `AccountingTemplatePicker` borraba
 * todo el `toolbarEndSlot` del editor (incluyendo el botón IA) y el usuario
 * perdía la opción tras varias acciones consecutivas.
 */
export class TemplatePickerBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.warn("[TemplatePickerBoundary] picker crashed", {
      error,
      componentStack: info.componentStack,
    });
    try {
      toast.error(
        "Las plantillas contables no cargaron. Recarga la página para recuperarlas.",
        { id: "tpl-picker-boundary" },
      );
    } catch {
      // toast puede no estar disponible en SSR; ignoramos.
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled
                  className="gap-1 text-xs h-7 px-2 opacity-70"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <FileText className="h-3.5 w-3.5" />
                  Plantillas contables
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              No se pudieron cargar las plantillas. Recarga la página (F5) para
              recuperarlas.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    return this.props.children;
  }
}
