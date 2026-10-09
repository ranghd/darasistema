// Navegacion con flechas en todo el sistema (como el menu de un cajero automatico):
// - En el menu lateral: ↑ ↓ entre secciones, Enter abre, → entra a la pantalla.
// - En la pantalla: las flechas mueven el foco al boton, campo o fila mas cercano en esa
//   direccion; ← desde el borde izquierdo vuelve al menu.
// - Dentro de un campo de texto, ← → mueven el cursor y solo saltan al llegar al borde.
// - Las filas clicables de las tablas se pueden enfocar y abrir con Enter.
// Una zona puede manejar sus propias flechas marcandola con data-nav-propio (ej. la Caja/POS).

const ENFOCABLES =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Dir = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

function visible(el: HTMLElement): boolean {
  if (el.tabIndex < 0 && !el.matches("a[href], button, input, select, textarea")) return false;
  if (el.getAttribute("tabindex") === "-1") return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  return getComputedStyle(el).visibility !== "hidden";
}

function ventanaAbierta(): HTMLElement | null {
  const capas = [...document.querySelectorAll<HTMLElement>("div.fixed.inset-0")];
  return capas[capas.length - 1] ?? null;
}

function enfocablesEn(raiz: ParentNode): HTMLElement[] {
  return [...raiz.querySelectorAll<HTMLElement>(ENFOCABLES)].filter(visible);
}

function enfocar(el: HTMLElement) {
  el.focus();
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
}

// El elemento mas cercano en la direccion pedida (distancia en el eje principal + desvio lateral).
function vecino(desde: HTMLElement, dir: Dir, candidatos: HTMLElement[]): HTMLElement | null {
  const a = desde.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let mejor: HTMLElement | null = null;
  let mejorPuntaje = Infinity;
  for (const el of candidatos) {
    if (el === desde || el.contains(desde) || desde.contains(el)) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    let principal: number;
    let lateral: number;
    // ← → se quedan en la misma linea (los elementos tienen que cruzarse en altura)
    const mismaLinea = b.top < a.bottom - 2 && b.bottom > a.top + 2;
    if (dir === "ArrowRight") {
      principal = b.left - a.right;
      lateral = Math.abs(by - ay);
      if (bx <= ax + 1 || !mismaLinea) continue;
    } else if (dir === "ArrowLeft") {
      principal = a.left - b.right;
      lateral = Math.abs(by - ay);
      if (bx >= ax - 1 || !mismaLinea) continue;
    } else if (dir === "ArrowDown") {
      principal = b.top - a.bottom;
      lateral = Math.abs(bx - ax);
      if (by <= ay + 1) continue;
    } else {
      principal = a.top - b.bottom;
      lateral = Math.abs(bx - ax);
      if (by >= ay - 1) continue;
    }
    const puntaje = Math.max(principal, 0) + lateral * 2.5;
    if (puntaje < mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejor = el;
    }
  }
  return mejor;
}

// ¿La flecha debe quedarse dentro del campo (mover el cursor)?
// En listas desplegables, numeros y fechas ↑ ↓ NO cambian el valor: pasan al siguiente
// campo (para cambiar una lista se abre con Enter). Solo el texto usa ← → para el cursor.
function laFlechaEsDelCampo(el: HTMLElement, dir: Dir): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLSelectElement) return false;
  if (el instanceof HTMLInputElement) {
    const tipo = el.type;
    if (dir === "ArrowUp" || dir === "ArrowDown") return false;
    if (tipo === "checkbox" || tipo === "radio" || tipo === "button" || tipo === "submit" || tipo === "range") return false;
    if (tipo === "date" || tipo === "time" || tipo === "datetime-local" || tipo === "month") return true;
    if (tipo === "number") return false;
    // texto: solo salimos cuando el cursor esta en el borde
    const ini = el.selectionStart ?? 0;
    const fin = el.selectionEnd ?? 0;
    if (dir === "ArrowLeft") return !(ini === 0 && fin === 0);
    return !(ini === el.value.length && fin === el.value.length);
  }
  return false;
}

let ultimoEnPantalla: HTMLElement | null = null;

export function activarNavegacionConFlechas(): () => void {
  const alPresionar = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
    const activo = (document.activeElement as HTMLElement | null) ?? document.body;

    // Enter sobre una lista desplegable la abre (las flechas no le cambian el valor)
    if ((e.key === "Enter" || e.key === " ") && activo instanceof HTMLSelectElement) {
      e.preventDefault();
      try {
        activo.showPicker();
      } catch {
        // si no se puede abrir, Alt+↓ tambien la abre
      }
      return;
    }

    // Enter sobre una fila o tarjeta enfocada = clic
    if (e.key === "Enter" && activo !== document.body && activo.matches("[tabindex]:not(a):not(button):not(input):not(select):not(textarea)")) {
      e.preventDefault();
      activo.click();
      return;
    }

    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const dir = e.key as Dir;
    if (activo !== document.body && laFlechaEsDelCampo(activo, dir)) return;
    if ((dir === "ArrowUp" || dir === "ArrowDown") && activo.closest("[data-nav-propio]")) return;
    // En listas y numeros la flecha nunca cambia el valor, aunque no haya a donde moverse.
    if (activo instanceof HTMLSelectElement || (activo instanceof HTMLInputElement && activo.type === "number")) e.preventDefault();

    const modal = ventanaAbierta();
    const menu = document.querySelector<HTMLElement>("aside nav");
    const pantalla = document.querySelector<HTMLElement>("main");

    // Dentro de una ventana: moverse solo entre sus elementos
    if (modal) {
      const desde = modal.contains(activo) ? activo : null;
      const destino = desde ? vecino(desde, dir, enfocablesEn(modal)) : enfocablesEn(modal)[0];
      if (destino) {
        e.preventDefault();
        enfocar(destino);
      }
      return;
    }

    const enMenu = !!menu && (menu.contains(activo) || activo.closest("aside") !== null);
    if (enMenu && menu) {
      const items = enfocablesEn(menu);
      const i = items.indexOf(activo);
      if (dir === "ArrowDown" || dir === "ArrowUp") {
        e.preventDefault();
        const j = i < 0 ? 0 : (i + (dir === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        enfocar(items[j]);
      } else if (dir === "ArrowRight" && pantalla) {
        e.preventDefault();
        const destino = ultimoEnPantalla && pantalla.contains(ultimoEnPantalla) && visible(ultimoEnPantalla) ? ultimoEnPantalla : enfocablesEn(pantalla)[0];
        if (destino) enfocar(destino);
      }
      return;
    }

    if (!pantalla) return;
    // Nada enfocado todavia: ↑ ↓ ← empiezan en el menu (en la seccion actual), → en la pantalla.
    if ((activo === document.body || !pantalla.contains(activo)) && dir !== "ArrowRight" && menu) {
      const actual = menu.querySelector<HTMLElement>("a.bg-brand-600") ?? enfocablesEn(menu)[0];
      if (actual) {
        e.preventDefault();
        enfocar(actual);
      }
      return;
    }
    if (activo === document.body || !pantalla.contains(activo)) {
      const primero = enfocablesEn(pantalla)[0];
      if (primero) {
        e.preventDefault();
        enfocar(primero);
      }
      return;
    }

    const destino = vecino(activo, dir, enfocablesEn(pantalla));
    if (destino) {
      e.preventDefault();
      enfocar(destino);
    } else if (dir === "ArrowLeft" && menu) {
      // borde izquierdo de la pantalla: volver al menu, a la seccion actual
      e.preventDefault();
      ultimoEnPantalla = activo;
      const actual = menu.querySelector<HTMLElement>("a.bg-brand-600") ?? enfocablesEn(menu)[0];
      if (actual) enfocar(actual);
    }
  };

  // Las filas y tarjetas clicables (cursor de mano) se vuelven enfocables para poder llegar con flechas.
  const marcarClicables = () => {
    document.querySelectorAll<HTMLElement>("main tr.cursor-pointer:not([tabindex]), .fixed tr.cursor-pointer:not([tabindex])").forEach((el) => el.setAttribute("tabindex", "0"));
  };
  marcarClicables();
  const observador = new MutationObserver(marcarClicables);
  observador.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("keydown", alPresionar);
  return () => {
    window.removeEventListener("keydown", alPresionar);
    observador.disconnect();
  };
}
