#!/usr/bin/env bash
# Comprueba que el modo de prueba de Agentes NO está en un sitio: busca su texto en todos los archivos .js que carga la página (y los que esos cargan).
# Uso: bash verificar-prueba.sh https://www.kawiil-central.mx
BASE="${1%/}"
[ -z "$BASE" ] && { echo "Uso: bash verificar-prueba.sh https://tu-dominio"; exit 2; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
curl -sf "$BASE/" -o "$T/index.html" || { echo "No pude abrir $BASE"; exit 2; }
grep -o 'assets/[A-Za-z0-9._-]*\.js' "$T/index.html" | sort -u > "$T/lista"
total=0; hallados=0; visto=""
while [ -s "$T/lista" ]; do
  siguiente=""
  for f in $(cat "$T/lista"); do
    case " $visto " in *" $f "*) continue;; esac
    visto="$visto $f"; total=$((total+1))
    curl -sf "$BASE/$f" -o "$T/js" || continue
    if grep -qE 'agentes-modo-prueba|DATOS DE EJEMPLO|Salir del modo de prueba' "$T/js"; then echo "ENCONTRADO en $f"; hallados=$((hallados+1)); fi
    for h in $(grep -o '[A-Za-z0-9_-]*-[A-Za-z0-9_-]\{6,12\}\.js' "$T/js" | sort -u); do
      case " $visto $siguiente " in *" assets/$h "*) ;; *) siguiente="$siguiente assets/$h";; esac
    done
  done
  printf '%s\n' $siguiente | sort -u | sed '/^$/d' > "$T/lista"
done
echo "Archivos revisados: $total"
if [ "$hallados" -eq 0 ]; then echo "RESULTADO: el modo de prueba NO está en $BASE"; else echo "RESULTADO: el modo de prueba SÍ está en $BASE"; exit 1; fi
