import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ShoppingBag, Package, Users, BarChart3, Calculator, Settings,
  Search, Bell, ChevronDown, Plus, Star, LayoutGrid,
  Coffee, Beer, Droplet, CupSoda, Salad, Croissant, CakeSlice, Scissors,
  UtensilsCrossed, PaintBucket, SprayCan,
  Percent, FileText, User, MoreHorizontal,
  Bookmark, Trash2, Wifi, Armchair, MoreVertical,
  ArrowLeft, ArrowRight, Check, CreditCard, Smartphone, Banknote, Gift,
  KeyRound, Shield, Building2, RotateCcw, AlertCircle, Eye, EyeOff,
  ChevronRight, Delete, X, CircleDot, Clock,
} from "lucide-react"

const Logo = ({ size = 28 }: { size?: number }) => (
  <div className="flex items-center gap-2.5">
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <path d="M5.2 4.4c-.85 0-1.55.65-1.55 1.5 0 .65 1.55 1.95 1.55 1.95s1.55-1.3 1.55-1.95c0-.85-.7-1.5-1.55-1.5z" fill="#E97058"/>
      <rect x="4" y="9.5" width="2.4" height="14.5" rx="1.2" fill="#1F2937"/>
      <rect x="8.8" y="6" width="2.4" height="18" rx="1.2" fill="#1F2937"/>
      <rect x="13.6" y="11" width="2.4" height="13" rx="1.2" fill="#1F2937"/>
      <rect x="18.4" y="8" width="2.4" height="16" rx="1.2" fill="#1F2937"/>
    </svg>
    <div className="flex items-baseline">
      <span className="text-[18px] font-semibold text-mipiace-ink tracking-tight leading-none">mipiace</span>
      <span className="text-[18px] font-semibold text-mipiace-coral tracking-tight leading-none">tpv</span>
    </div>
  </div>
)

const fmt = (n: number) => n.toFixed(2).replace(".", ",") + " €"

// ─────────────────────────────────────────────────────────────────────
// Shared shell for full TPV screens (sidebar + topbar)
// ─────────────────────────────────────────────────────────────────────
const sidebarItems = [
  { id: "venta", label: "Venta", icon: ShoppingBag, active: true },
  { id: "productos", label: "Productos", icon: Package },
  { id: "clientes", label: "Clientes", icon: Users },
  { id: "informes", label: "Informes", icon: BarChart3 },
  { id: "caja", label: "Caja", icon: Calculator },
  { id: "ajustes", label: "Ajustes", icon: Settings },
]

const TpvShell = ({ children, headerSlot }: { children: React.ReactNode; headerSlot?: React.ReactNode }) => (
  <div className="min-h-screen bg-mipiace-stone flex flex-col font-sans">
    <div className="flex-1 flex max-w-[1680px] w-full mx-auto bg-white">
      {/* Sidebar — hides on small screens */}
      <aside className="hidden md:flex w-[88px] xl:w-[240px] shrink-0 border-r border-slate-200 flex-col px-3 xl:px-5 py-5">
        <div className="mb-7 xl:mb-8 flex justify-center xl:justify-start">
          <div className="xl:hidden">
            <svg width="32" height="32" viewBox="0 0 28 28" fill="none">
              <path d="M5.2 4.4c-.85 0-1.55.65-1.55 1.5 0 .65 1.55 1.95 1.55 1.95s1.55-1.3 1.55-1.95c0-.85-.7-1.5-1.55-1.5z" fill="#E97058"/>
              <rect x="4" y="9.5" width="2.4" height="14.5" rx="1.2" fill="#1F2937"/>
              <rect x="8.8" y="6" width="2.4" height="18" rx="1.2" fill="#1F2937"/>
              <rect x="13.6" y="11" width="2.4" height="13" rx="1.2" fill="#1F2937"/>
              <rect x="18.4" y="8" width="2.4" height="16" rx="1.2" fill="#1F2937"/>
            </svg>
          </div>
          <div className="hidden xl:block"><Logo /></div>
        </div>
        <nav className="space-y-1.5">
          {sidebarItems.map(item => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                title={item.label}
                className={
                  item.active
                    ? "w-full h-12 flex items-center xl:gap-3 px-3 xl:px-4 rounded-xl bg-mipiace-coral-soft text-mipiace-coral-dark text-[14.5px] font-medium justify-center xl:justify-start"
                    : "w-full h-12 flex items-center xl:gap-3 px-3 xl:px-4 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-mipiace-ink text-[14.5px] font-medium justify-center xl:justify-start"
                }
              >
                <Icon className={item.active ? "w-[19px] h-[19px] text-mipiace-coral shrink-0" : "w-[19px] h-[19px] text-slate-500 shrink-0"} strokeWidth={2.1}/>
                <span className="hidden xl:inline">{item.label}</span>
              </button>
            )
          })}
        </nav>
        <div className="mt-auto hidden xl:block">
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="text-[10.5px] uppercase tracking-wider text-slate-400 font-medium mb-1.5">Integrado con</div>
            <div className="flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2L20 12L12 22L4 12L12 2Z" fill="#E97058"/></svg>
              <span className="text-[18px] font-semibold text-mipiace-ink tracking-tight">holded</span>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {headerSlot ?? <TpvTopbar />}
        {children}
        <StatusBar />
      </div>
    </div>
  </div>
)

const TpvTopbar = ({ context }: { context?: React.ReactNode }) => (
  <header className="h-[88px] md:h-[100px] border-b border-slate-200 flex items-center px-4 md:px-7 gap-3 shrink-0">
    <div className="md:hidden">
      <Logo size={24} />
    </div>
    <div className="flex-1 max-w-3xl">
      <div className="relative">
        <Search className="absolute left-4 md:left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" strokeWidth={2.25}/>
        <Input
          placeholder="Buscar producto, cliente o referencia…"
          className="h-12 md:h-14 pl-11 md:pl-12 pr-4 text-[14px] md:text-[14.5px] bg-mipiace-stone border-transparent rounded-2xl focus-visible:ring-2 focus-visible:ring-mipiace-coral/40 focus-visible:bg-white focus-visible:border-mipiace-coral/30"
        />
      </div>
    </div>
    <div className="flex items-center gap-2 md:gap-2.5 ml-auto">
      {context ?? (
        <button className="h-12 md:h-14 px-3 md:px-5 rounded-2xl bg-mipiace-coral-soft border border-mipiace-coral/25 flex items-center gap-2 text-[13.5px] md:text-[14px] font-medium text-mipiace-coral-dark hover:bg-mipiace-coral/15">
          <Armchair className="w-[17px] h-[17px]" strokeWidth={2.25}/>
          <span className="hidden sm:inline">Mesa 7</span>
          <ChevronDown className="w-3.5 h-3.5"/>
        </button>
      )}
      <button className="h-12 md:h-14 w-12 md:w-14 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark flex items-center justify-center text-white" aria-label="Nueva venta">
        <Plus className="w-[20px] h-[20px]" strokeWidth={2.25}/>
      </button>
      <button className="hidden md:flex h-14 w-14 rounded-2xl bg-mipiace-stone hover:bg-slate-100 items-center justify-center relative" aria-label="Notificaciones">
        <Bell className="w-[18px] h-[18px] text-slate-600" strokeWidth={2.25}/>
        <span className="absolute top-3.5 right-3.5 w-2 h-2 bg-mipiace-coral rounded-full ring-2 ring-mipiace-stone"/>
      </button>
      <button className="h-12 md:h-14 pl-1.5 md:pl-2 pr-2.5 md:pr-3.5 rounded-2xl bg-mipiace-stone hover:bg-slate-100 flex items-center gap-2 md:gap-2.5">
        <span className="h-9 md:h-10 w-9 md:w-10 rounded-xl bg-mipiace-ink text-white text-[12.5px] md:text-[13px] font-medium flex items-center justify-center">AB</span>
        <ChevronDown className="hidden md:block w-3.5 h-3.5 text-slate-500"/>
      </button>
    </div>
  </header>
)

const StatusBar = () => (
  <footer className="h-[56px] md:h-[68px] border-t border-slate-200 grid grid-cols-3 items-center px-4 md:px-7 text-[12px] md:text-[13px] shrink-0">
    <div className="flex items-center gap-2.5">
      <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full"/>
      <span className="text-mipiace-ink font-medium hidden sm:inline">Caja abierta</span>
    </div>
    <div className="text-center text-slate-600 font-medium">Turno mañana</div>
    <div className="flex items-center justify-end gap-3 text-slate-500">
      <span className="tabular-nums font-medium hidden sm:inline">Martes 14 may · 12:30</span>
      <Wifi className="w-4 h-4 text-emerald-500" strokeWidth={2.25}/>
    </div>
  </footer>
)

// ─────────────────────────────────────────────────────────────────────
// SCREEN 1: TPV — Emparejamiento de dispositivo (mobile-first)
// ─────────────────────────────────────────────────────────────────────
const TpvPairScreen = () => {
  const [code, setCode] = useState(["", "", "", "", "", ""])
  return (
    <div className="min-h-screen bg-gradient-to-br from-mipiace-stone to-white flex items-center justify-center p-5 font-sans">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-10">
          <Logo size={36} />
        </div>
        <div className="bg-white rounded-3xl border border-slate-200 p-7 md:p-10">
          <h1 className="text-[22px] md:text-[24px] font-semibold text-mipiace-ink tracking-tight mb-2">Vincula este dispositivo</h1>
          <p className="text-[14px] text-slate-500 mb-7 leading-relaxed">
            Pide al propietario o encargado un código de 6 dígitos desde el admin y mételo aquí. El código expira en una hora.
          </p>
          <div className="grid grid-cols-6 gap-2 mb-6">
            {code.map((c, i) => (
              <input
                key={i}
                value={c}
                onChange={() => {}}
                placeholder={["3","7","2","1","4","6"][i]}
                inputMode="numeric"
                maxLength={1}
                className="h-14 md:h-16 text-center text-[22px] md:text-[26px] font-semibold text-mipiace-ink rounded-xl border border-slate-200 bg-mipiace-stone focus:outline-none focus:ring-2 focus:ring-mipiace-coral/40 focus:border-mipiace-coral/30 focus:bg-white tabular-nums placeholder:text-slate-300 placeholder:font-medium"
              />
            ))}
          </div>
          <Button className="w-full h-14 bg-mipiace-coral hover:bg-mipiace-coral-dark text-white font-medium text-[15px] rounded-2xl">
            Vincular dispositivo
          </Button>
          <div className="mt-6 pt-6 border-t border-slate-100 text-center">
            <p className="text-[12.5px] text-slate-400 leading-relaxed">
              Una vez vinculado, este dispositivo quedará asociado a una caja específica y no volverá a pedirte código.
            </p>
          </div>
        </div>
        <div className="text-center mt-6 text-[11.5px] text-slate-400">
          mipiacetpv · v1.0.0 · Conectado a mipiacetpv.tech
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// SCREEN 2: TPV — Login cajero por PIN
// ─────────────────────────────────────────────────────────────────────
const TpvPinScreen = () => {
  const [pin, setPin] = useState("●●●")
  return (
    <div className="min-h-screen bg-mipiace-stone flex flex-col font-sans">
      <header className="h-[72px] md:h-[88px] border-b border-slate-200 flex items-center justify-between px-5 md:px-7 bg-white">
        <Logo size={26} />
        <div className="text-[12.5px] text-slate-500">Caja 1 · Mostrador</div>
      </header>
      <main className="flex-1 flex items-center justify-center p-5">
        <div className="w-full max-w-5xl grid md:grid-cols-2 gap-5 md:gap-8">
          {/* Recent cashiers */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 md:p-8">
            <h2 className="text-[14px] font-medium text-slate-500 uppercase tracking-wider mb-5">Cajeros recientes</h2>
            <div className="space-y-2.5">
              {[
                { name: "Lucía Martín", initials: "LM", active: true, shift: "Turno abierto · 2h 14m" },
                { name: "Carlos Pérez", initials: "CP", shift: "Último: ayer 20:30" },
                { name: "Marta Soler", initials: "MS", shift: "Último: 12 may" },
              ].map(c => (
                <button
                  key={c.name}
                  className={
                    c.active
                      ? "w-full p-4 rounded-2xl bg-mipiace-coral-soft border border-mipiace-coral/30 flex items-center gap-4 text-left"
                      : "w-full p-4 rounded-2xl bg-white border border-slate-200 hover:border-slate-300 flex items-center gap-4 text-left"
                  }
                >
                  <span className={c.active ? "h-12 w-12 rounded-xl bg-mipiace-coral text-white text-[15px] font-semibold flex items-center justify-center shrink-0" : "h-12 w-12 rounded-xl bg-mipiace-stone text-mipiace-ink text-[15px] font-semibold flex items-center justify-center shrink-0"}>
                    {c.initials}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className={c.active ? "text-[15px] font-medium text-mipiace-coral-dark" : "text-[15px] font-medium text-mipiace-ink"}>{c.name}</div>
                    <div className="text-[12.5px] text-slate-500 mt-0.5">{c.shift}</div>
                  </div>
                  <ChevronRight className={c.active ? "w-4 h-4 text-mipiace-coral" : "w-4 h-4 text-slate-300"}/>
                </button>
              ))}
            </div>
            <button className="mt-4 w-full p-4 rounded-2xl border-2 border-dashed border-slate-200 hover:border-mipiace-coral/40 text-slate-500 hover:text-mipiace-coral-dark text-[13.5px] font-medium flex items-center justify-center gap-2">
              <Plus className="w-4 h-4" strokeWidth={2.25}/>
              Iniciar sesión con otro cajero
            </button>
          </div>

          {/* Keypad */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 md:p-8 flex flex-col">
            <div className="text-center mb-6">
              <div className="text-[14px] text-slate-500 mb-1">Introduce el PIN de</div>
              <div className="text-[20px] font-semibold text-mipiace-ink tracking-tight">Lucía Martín</div>
            </div>
            <div className="flex justify-center gap-3 mb-7">
              {[0, 1, 2, 3].map(i => (
                <div
                  key={i}
                  className={
                    i < 3
                      ? "w-3.5 h-3.5 rounded-full bg-mipiace-coral"
                      : "w-3.5 h-3.5 rounded-full bg-slate-200"
                  }
                />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2.5 md:gap-3 max-w-xs mx-auto w-full">
              {["1","2","3","4","5","6","7","8","9"].map(n => (
                <button
                  key={n}
                  className="h-14 md:h-16 bg-mipiace-stone hover:bg-slate-100 rounded-2xl text-[22px] md:text-[24px] font-medium text-mipiace-ink tabular-nums"
                >
                  {n}
                </button>
              ))}
              <button className="h-14 md:h-16 rounded-2xl text-[14px] text-slate-400 hover:text-mipiace-ink font-medium">Cancelar</button>
              <button className="h-14 md:h-16 bg-mipiace-stone hover:bg-slate-100 rounded-2xl text-[22px] md:text-[24px] font-medium text-mipiace-ink tabular-nums">0</button>
              <button className="h-14 md:h-16 bg-mipiace-stone hover:bg-slate-100 rounded-2xl flex items-center justify-center text-slate-500">
                <Delete className="w-5 h-5" strokeWidth={2.25}/>
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// SCREEN 3: TPV — Apertura de turno
// ─────────────────────────────────────────────────────────────────────
const TpvShiftOpenScreen = () => (
  <div className="min-h-screen bg-mipiace-stone flex items-center justify-center p-5 font-sans">
    <div className="w-full max-w-lg">
      <div className="flex justify-center mb-7"><Logo size={32}/></div>
      <div className="bg-white rounded-3xl border border-slate-200 p-7 md:p-9">
        <div className="flex items-center gap-3 mb-1">
          <span className="h-11 w-11 rounded-xl bg-mipiace-coral text-white text-[15px] font-semibold flex items-center justify-center">LM</span>
          <div>
            <div className="text-[15px] font-medium text-mipiace-ink">Lucía Martín</div>
            <div className="text-[12.5px] text-slate-500">Caja 1 · Mostrador</div>
          </div>
        </div>
        <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight mt-6 mb-1.5">Abrir turno</h1>
        <p className="text-[14px] text-slate-500 mb-6 leading-relaxed">
          Cuenta el efectivo del cajón antes de empezar el turno y anótalo aquí. Aparecerá como fondo inicial en el arqueo de cierre.
        </p>
        <label className="block text-[13px] font-medium text-mipiace-ink mb-2">Fondo de caja inicial</label>
        <div className="relative mb-6">
          <Input
            value="120,00"
            className="h-16 pr-12 text-[26px] font-semibold tracking-tight bg-mipiace-stone border-transparent rounded-2xl focus-visible:ring-2 focus-visible:ring-mipiace-coral/40 focus-visible:bg-white tabular-nums text-right"
          />
          <span className="absolute right-5 top-1/2 -translate-y-1/2 text-[20px] font-semibold text-slate-400">€</span>
        </div>
        <div className="grid grid-cols-4 gap-2 mb-7">
          {["50,00", "100,00", "150,00", "200,00"].map(v => (
            <button key={v} className="h-11 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-[13px] font-medium text-mipiace-ink tabular-nums">{v} €</button>
          ))}
        </div>
        <Button className="w-full h-14 bg-mipiace-coral hover:bg-mipiace-coral-dark text-white font-medium text-[15px] rounded-2xl">
          Abrir turno
        </Button>
        <button className="w-full mt-3 h-12 text-[13.5px] text-slate-500 hover:text-mipiace-ink font-medium">
          Volver a selección de cajero
        </button>
      </div>
    </div>
  </div>
)

// ─────────────────────────────────────────────────────────────────────
// SCREEN 4: TPV — Venta rápida (la v4)
// ─────────────────────────────────────────────────────────────────────
type Tone = "amber" | "sky" | "red" | "green" | "stone" | "rose"
const toneStyles: Record<Tone, string> = {
  amber: "bg-amber-50 text-amber-700",
  sky: "bg-sky-50 text-sky-700",
  red: "bg-red-50 text-red-700",
  green: "bg-emerald-50 text-emerald-700",
  stone: "bg-stone-100 text-stone-700",
  rose: "bg-rose-50 text-rose-700",
}
const products: { name: string; price: number; icon: any; tone: Tone }[] = [
  { name: "Café", price: 1.40, icon: Coffee, tone: "amber" },
  { name: "Cortado", price: 1.50, icon: Coffee, tone: "amber" },
  { name: "Cerveza", price: 2.20, icon: Beer, tone: "amber" },
  { name: "Agua 50cl", price: 1.20, icon: Droplet, tone: "sky" },
  { name: "Refresco", price: 1.80, icon: CupSoda, tone: "red" },
  { name: "Tarta de queso", price: 3.20, icon: CakeSlice, tone: "rose" },
  { name: "Croissant", price: 1.60, icon: Croissant, tone: "amber" },
  { name: "Ensalada", price: 4.50, icon: Salad, tone: "green" },
  { name: "Menú del día", price: 9.90, icon: UtensilsCrossed, tone: "stone" },
  { name: "Corte de pelo", price: 18, icon: Scissors, tone: "stone" },
  { name: "Barba", price: 8, icon: Scissors, tone: "stone" },
  { name: "Color", price: 25, icon: PaintBucket, tone: "stone" },
  { name: "Mechas", price: 35, icon: SprayCan, tone: "stone" },
]
const cartLines: { qty: number; name: string; price: number; mod?: string }[] = [
  { qty: 2, name: "Café", price: 1.40 },
  { qty: 1, name: "Cortado", price: 1.50 },
  { qty: 1, name: "Tarta de queso", price: 3.20 },
  { qty: 1, name: "Menú del día", price: 9.90, mod: "Sin postre" },
  { qty: 2, name: "Cerveza", price: 2.20 },
]
const subtotal = cartLines.reduce((acc, l) => acc + l.qty * l.price, 0)
const discount = 1.20
const total = subtotal - discount

const SaleContent = ({ tableLabel }: { tableLabel?: string }) => (
  <div className="flex-1 grid lg:grid-cols-[1fr_460px] gap-4 lg:gap-6 p-4 md:p-7 min-h-0">
    <section className="flex flex-col min-w-0 order-2 lg:order-1">
      <div className="flex items-center gap-2 mb-4 md:mb-6 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        {[{ id: "fav", label: "Favoritos", active: true }, { id: "beb", label: "Bebidas" }, { id: "com", label: "Comida" }, { id: "ser", label: "Servicios" }, { id: "pro", label: "Productos" }].map(c => (
          <button
            key={c.id}
            className={
              c.active
                ? "h-11 md:h-12 px-4 md:px-5 rounded-2xl bg-mipiace-coral text-white text-[13.5px] md:text-[14px] font-medium flex items-center gap-2 shrink-0"
                : "h-11 md:h-12 px-4 md:px-5 rounded-2xl bg-mipiace-stone text-slate-600 hover:text-mipiace-ink text-[13.5px] md:text-[14px] font-medium border border-transparent hover:border-slate-200 shrink-0"
            }
          >
            {c.active && <Star className="w-3.5 h-3.5 fill-white" strokeWidth={2.5}/>}
            {c.label}
          </button>
        ))}
        <div className="ml-auto shrink-0 hidden md:block">
          <button className="h-12 w-12 rounded-2xl bg-mipiace-stone hover:bg-slate-100 flex items-center justify-center text-slate-600">
            <LayoutGrid className="w-[17px] h-[17px]" strokeWidth={2.25}/>
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-3.5 mb-5 md:mb-6">
        {products.map(p => {
          const Icon = p.icon
          return (
            <button
              key={p.name}
              className="group bg-white rounded-2xl border border-slate-200 overflow-hidden text-left hover:border-mipiace-coral/50 hover:shadow-sm transition-all"
            >
              <div className={`aspect-[5/4] flex items-center justify-center ${toneStyles[p.tone]}`}>
                <Icon className="w-10 h-10 md:w-12 md:h-12 opacity-80" strokeWidth={1.4}/>
              </div>
              <div className="px-3 md:px-3.5 py-2.5 md:py-3">
                <div className="text-[13px] md:text-[13.5px] font-medium text-mipiace-ink truncate">{p.name}</div>
                <div className="text-[12.5px] md:text-[13px] text-slate-500 mt-0.5 tabular-nums">{fmt(p.price)}</div>
              </div>
            </button>
          )
        })}
        <button className="bg-transparent rounded-2xl border-2 border-dashed border-slate-300 hover:border-mipiace-coral/50 hover:bg-mipiace-coral-soft/40 flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-mipiace-coral-dark text-[13px] font-medium min-h-[140px] md:min-h-[180px]">
          <Plus className="w-6 h-6" strokeWidth={2}/>
          Añadir
        </button>
      </div>
      <div className="grid grid-cols-4 gap-2 md:gap-3 mt-auto">
        {[{ i: Percent, l: "Desc." }, { i: FileText, l: "Nota" }, { i: User, l: "Cliente" }, { i: MoreHorizontal, l: "Más" }].map((x, idx) => {
          const I = x.i
          return (
            <button key={idx} className="h-12 md:h-14 bg-mipiace-stone hover:bg-slate-100 rounded-2xl flex items-center justify-center gap-2 text-[13px] md:text-[14px] font-medium text-mipiace-ink">
              <I className="w-[16px] md:w-[17px] h-[16px] md:h-[17px] text-slate-500" strokeWidth={2.25}/>
              <span>{x.l}</span>
            </button>
          )
        })}
      </div>
    </section>

    <aside className="bg-white rounded-3xl border border-slate-200 flex flex-col order-1 lg:order-2 max-h-[60vh] lg:max-h-none">
      <div className="flex items-center justify-between px-5 md:px-7 pt-5 md:pt-6 pb-4 md:pb-5 border-b border-slate-100">
        <div>
          <h2 className="text-[18px] md:text-[20px] font-semibold text-mipiace-ink tracking-tight">{tableLabel ?? "Ticket de venta"}</h2>
          {tableLabel && <div className="text-[12.5px] text-slate-500 mt-0.5">4 comensales · 23 min · Lucía</div>}
        </div>
        <button className="h-9 w-9 rounded-lg hover:bg-slate-50 flex items-center justify-center text-slate-400">
          <MoreVertical className="w-[17px] h-[17px]" strokeWidth={2.25}/>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 md:px-7 py-1">
        <div className="divide-y divide-slate-100">
          {cartLines.map((l, i) => (
            <div key={i} className="group flex items-center gap-3 md:gap-3.5 py-3.5 md:py-4">
              <span className="shrink-0 h-9 w-9 rounded-xl bg-mipiace-stone text-mipiace-ink text-[14px] font-semibold tabular-nums flex items-center justify-center">{l.qty}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] md:text-[14.5px] font-medium text-mipiace-ink leading-tight">{l.name}</div>
                {l.mod ? <div className="text-[12.5px] text-slate-500 mt-0.5">{l.mod}</div>
                  : l.qty > 1 ? <div className="text-[12.5px] text-slate-400 tabular-nums mt-0.5">{fmt(l.price)} ud.</div>
                  : null}
              </div>
              <div className="text-right shrink-0 flex items-center gap-2">
                <span className="text-[14px] md:text-[14.5px] font-medium text-mipiace-ink tabular-nums">{fmt(l.qty * l.price)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="px-5 md:px-7 py-4 md:py-5 border-t border-slate-100 space-y-2">
        <div className="flex justify-between text-[13.5px] md:text-[14px]"><span className="text-slate-500">Subtotal</span><span className="text-mipiace-ink tabular-nums">{fmt(subtotal)}</span></div>
        <div className="flex justify-between text-[13.5px] md:text-[14px]"><span className="text-slate-500">Descuento</span><span className="text-mipiace-coral tabular-nums font-medium">−{fmt(discount)}</span></div>
      </div>
      <div className="px-5 md:px-7 pt-4 md:pt-5 pb-5 md:pb-6 border-t border-slate-200">
        <div className="flex items-baseline justify-between mb-4 md:mb-5">
          <span className="text-[17px] md:text-[18px] font-semibold text-mipiace-ink">Total</span>
          <span className="text-[30px] md:text-[36px] font-semibold text-mipiace-ink tabular-nums tracking-tight">{fmt(total)}</span>
        </div>
        <div className="grid grid-cols-[120px_1fr] md:grid-cols-[160px_1fr] gap-2 md:gap-3">
          <Button variant="outline" className="h-14 md:h-16 border-mipiace-coral/30 text-mipiace-coral-dark hover:bg-mipiace-coral-soft hover:text-mipiace-coral-dark hover:border-mipiace-coral/50 font-medium text-[14px] md:text-[15px] gap-2 rounded-2xl">
            <Bookmark className="w-[16px] md:w-[17px] h-[16px] md:h-[17px]" strokeWidth={2.25}/>
            Guardar
          </Button>
          <Button className="h-14 md:h-16 bg-mipiace-coral hover:bg-mipiace-coral-dark text-white font-medium text-[14px] md:text-[15px] flex items-center justify-between px-4 md:px-5 rounded-2xl">
            <span>Cobrar</span>
            <span className="tabular-nums">{fmt(total)}</span>
          </Button>
        </div>
      </div>
    </aside>
  </div>
)

const TpvSaleScreen = () => <TpvShell>{<SaleContent />}</TpvShell>

// ─────────────────────────────────────────────────────────────────────
// SCREEN 5: TPV — Mapa de sala
// ─────────────────────────────────────────────────────────────────────
type TableState = "free" | "open" | "billing"
const tables: { id: string; capacity: number; state: TableState; time?: string; total?: number; people?: number; server?: string }[] = [
  { id: "M1", capacity: 2, state: "open", time: "37 min", total: 12.40, people: 2, server: "LM" },
  { id: "M2", capacity: 2, state: "free" },
  { id: "M3", capacity: 4, state: "open", time: "12 min", total: 6.80, people: 3, server: "LM" },
  { id: "M4", capacity: 4, state: "billing", time: "1h 04m", total: 47.50, people: 4, server: "CP" },
  { id: "M5", capacity: 4, state: "free" },
  { id: "M6", capacity: 6, state: "open", time: "23 min", total: 21.80, people: 4, server: "LM" },
  { id: "M7", capacity: 6, state: "open", time: "8 min", total: 4.40, people: 2, server: "MS" },
  { id: "M8", capacity: 2, state: "free" },
]
const barSeats: { id: string; state: TableState; total?: number }[] = [
  { id: "B1", state: "open", total: 2.80 },
  { id: "B2", state: "free" },
  { id: "B3", state: "open", total: 4.40 },
  { id: "B4", state: "open", total: 1.40 },
  { id: "B5", state: "free" },
  { id: "B6", state: "free" },
  { id: "B7", state: "billing", total: 6.20 },
  { id: "B8", state: "free" },
]

const stateStyles: Record<TableState, string> = {
  free: "bg-white border-slate-200 text-slate-500 hover:border-slate-300",
  open: "bg-mipiace-coral-soft border-mipiace-coral/40 text-mipiace-coral-dark",
  billing: "bg-amber-50 border-amber-300/60 text-amber-800",
}

const TpvMapScreen = () => (
  <TpvShell>
    <div className="flex-1 p-4 md:p-7 overflow-y-auto">
      <div className="flex flex-wrap items-center justify-between mb-5 gap-3">
        <div>
          <h1 className="text-[22px] md:text-[24px] font-semibold text-mipiace-ink tracking-tight">Mapa de sala</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">5 mesas ocupadas · 11 puestos libres · 4 camareros activos</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-11 border-slate-200 text-slate-600 rounded-xl gap-2">
            <CircleDot className="w-3.5 h-3.5"/>
            Filtros
          </Button>
          <Button className="h-11 bg-mipiace-coral hover:bg-mipiace-coral-dark text-white rounded-xl gap-2">
            <Plus className="w-4 h-4" strokeWidth={2.25}/>
            Nueva venta rápida
          </Button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mb-6 text-[12.5px] text-slate-500">
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-md border border-slate-300 bg-white"/> Libre</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-md bg-mipiace-coral-soft border border-mipiace-coral/40"/> Ocupada</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-md bg-amber-50 border border-amber-300/60"/> Pidiendo cuenta</div>
      </div>

      <div className="mb-7">
        <div className="text-[11px] uppercase tracking-wider font-medium text-slate-400 mb-3">Salón</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {tables.map(t => (
            <button
              key={t.id}
              className={`relative aspect-[7/6] rounded-2xl border-2 ${stateStyles[t.state]} flex flex-col p-3.5 text-left transition-all hover:scale-[1.02]`}
            >
              <div className="flex justify-between items-start">
                <span className="text-[18px] font-semibold tracking-tight">{t.id}</span>
                <span className="text-[10.5px] uppercase tracking-wider font-medium opacity-80">{t.capacity} pax</span>
              </div>
              {t.state !== "free" && (
                <div className="mt-auto">
                  <div className="flex items-center gap-1.5 text-[11.5px] opacity-90 mb-1">
                    <Clock className="w-3 h-3"/>
                    <span className="tabular-nums">{t.time}</span>
                    <span className="opacity-50">·</span>
                    <span>{t.people}p</span>
                    <span className="opacity-50">·</span>
                    <span>{t.server}</span>
                  </div>
                  <div className="text-[18px] font-semibold tabular-nums tracking-tight">{fmt(t.total!)}</div>
                </div>
              )}
              {t.state === "billing" && (
                <span className="absolute top-2 right-2 text-[9.5px] font-semibold uppercase tracking-wider bg-amber-200/70 text-amber-900 px-1.5 py-0.5 rounded">cuenta</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wider font-medium text-slate-400 mb-3">Barra · 8 puestos</div>
        <div className="grid grid-cols-4 md:grid-cols-8 gap-2.5">
          {barSeats.map(s => (
            <button key={s.id} className={`aspect-square rounded-xl border-2 ${stateStyles[s.state]} flex flex-col items-center justify-center p-2 transition-all hover:scale-[1.05]`}>
              <span className="text-[14px] font-semibold">{s.id}</span>
              {s.total && <span className="text-[11px] tabular-nums mt-0.5">{fmt(s.total)}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  </TpvShell>
)

// ─────────────────────────────────────────────────────────────────────
// SCREEN 6: TPV — Mesa abierta (reusa SaleContent con label)
// ─────────────────────────────────────────────────────────────────────
const TpvTableScreen = () => (
  <TpvShell headerSlot={<TpvTopbar />}>
    <SaleContent tableLabel="Mesa 6" />
  </TpvShell>
)

// ─────────────────────────────────────────────────────────────────────
// SCREEN 7: TPV — Cobro
// ─────────────────────────────────────────────────────────────────────
const TpvCheckoutScreen = () => {
  const cobrar = 20.60
  const recibido = 50.00
  return (
    <div className="min-h-screen bg-mipiace-ink/95 flex items-center justify-center p-4 md:p-7 font-sans">
      <div className="w-full max-w-5xl bg-white rounded-3xl overflow-hidden grid lg:grid-cols-[1fr_460px]">
        <div className="p-7 md:p-10 flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <button className="h-10 w-10 rounded-xl bg-mipiace-stone hover:bg-slate-100 flex items-center justify-center text-slate-600">
              <ArrowLeft className="w-[18px] h-[18px]" strokeWidth={2.25}/>
            </button>
            <span className="text-[13px] text-slate-500">Mesa 7 · 5 líneas</span>
          </div>
          <div className="mb-6">
            <div className="text-[14px] text-slate-500 mb-1">A cobrar</div>
            <div className="text-[56px] md:text-[64px] font-semibold text-mipiace-ink tracking-tight leading-none tabular-nums">{fmt(cobrar)}</div>
          </div>
          <div className="mb-5">
            <div className="text-[13px] font-medium text-mipiace-ink mb-3">Método de pago</div>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { i: Banknote, l: "Efectivo", active: true },
                { i: CreditCard, l: "Tarjeta" },
                { i: Smartphone, l: "Bizum" },
                { i: Gift, l: "Vale" },
              ].map(m => {
                const I = m.i
                return (
                  <button
                    key={m.l}
                    className={
                      m.active
                        ? "h-16 rounded-2xl border-2 border-mipiace-coral bg-mipiace-coral-soft text-mipiace-coral-dark font-medium text-[14px] flex items-center justify-center gap-2.5"
                        : "h-16 rounded-2xl border border-slate-200 hover:border-slate-300 bg-white text-mipiace-ink font-medium text-[14px] flex items-center justify-center gap-2.5"
                    }
                  >
                    <I className="w-[18px] h-[18px]" strokeWidth={2.1}/>
                    {m.l}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex-1">
            <div className="text-[13px] font-medium text-mipiace-ink mb-3">Importe recibido</div>
            <Input value="50,00" className="h-16 text-[28px] font-semibold tabular-nums text-right bg-mipiace-stone border-transparent rounded-2xl mb-3 tracking-tight" readOnly/>
            <div className="grid grid-cols-4 gap-2">
              {["+5", "+10", "+20", "+50", "Justo", "100", "Otro", "C"].map(q => (
                <button key={q} className="h-12 rounded-xl bg-mipiace-stone hover:bg-slate-100 text-[14px] font-medium text-mipiace-ink">
                  {q}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="bg-mipiace-stone p-7 md:p-10 flex flex-col">
          <div className="mb-6">
            <div className="text-[13px] text-slate-500 mb-1">Cambio</div>
            <div className="text-[44px] md:text-[52px] font-semibold text-mipiace-coral tracking-tight leading-none tabular-nums">{fmt(recibido - cobrar)}</div>
          </div>
          <div className="bg-white rounded-2xl p-5 mb-6">
            <div className="text-[12px] uppercase tracking-wider font-medium text-slate-400 mb-3">Resumen</div>
            <div className="space-y-2 text-[13.5px]">
              <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="tabular-nums">{fmt(21.80)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Descuento</span><span className="text-mipiace-coral tabular-nums">−{fmt(1.20)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Recibido</span><span className="tabular-nums">{fmt(recibido)}</span></div>
              <div className="pt-2 border-t border-slate-100 flex justify-between font-medium text-mipiace-ink"><span>Total</span><span className="tabular-nums">{fmt(cobrar)}</span></div>
            </div>
          </div>
          <div className="space-y-2 mb-6">
            <label className="flex items-center gap-3 p-3 bg-white rounded-xl cursor-pointer">
              <span className="w-4 h-4 rounded border-2 border-mipiace-coral bg-mipiace-coral flex items-center justify-center"><Check className="w-3 h-3 text-white" strokeWidth={3}/></span>
              <span className="text-[13.5px] text-mipiace-ink font-medium">Imprimir ticket</span>
            </label>
            <label className="flex items-center gap-3 p-3 bg-white rounded-xl cursor-pointer">
              <span className="w-4 h-4 rounded border-2 border-slate-300"/>
              <span className="text-[13.5px] text-slate-600 font-medium flex-1">Enviar por email</span>
              <span className="text-[12px] text-slate-400">opcional</span>
            </label>
            <label className="flex items-center gap-3 p-3 bg-white rounded-xl cursor-pointer">
              <span className="w-4 h-4 rounded border-2 border-slate-300"/>
              <span className="text-[13.5px] text-slate-600 font-medium">Ticket regalo</span>
            </label>
          </div>
          <Button className="mt-auto w-full h-16 bg-mipiace-coral hover:bg-mipiace-coral-dark text-white font-medium text-[16px] rounded-2xl flex items-center justify-between px-6">
            <span>Confirmar cobro</span>
            <span className="tabular-nums">{fmt(cobrar)}</span>
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// SCREEN 8: Admin — Login
// ─────────────────────────────────────────────────────────────────────
const AdminLoginScreen = () => (
  <div className="min-h-screen bg-gradient-to-br from-mipiace-stone to-white flex items-center justify-center p-5 font-sans">
    <div className="w-full max-w-md">
      <div className="flex justify-center mb-10"><Logo size={36}/></div>
      <div className="bg-white rounded-3xl border border-slate-200 p-8 md:p-10">
        <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight mb-1.5">Inicia sesión</h1>
        <p className="text-[14px] text-slate-500 mb-7 leading-relaxed">
          Accede al panel de administración de tu TPV.
        </p>
        <label className="block text-[13px] font-medium text-mipiace-ink mb-2">Email</label>
        <Input value="m.oyola@mipiace.es" readOnly className="h-12 mb-4 bg-mipiace-stone border-transparent rounded-xl text-[14px]"/>
        <label className="block text-[13px] font-medium text-mipiace-ink mb-2">Contraseña</label>
        <div className="relative mb-4">
          <Input type="password" value="••••••••••••" readOnly className="h-12 pr-12 bg-mipiace-stone border-transparent rounded-xl text-[14px]"/>
          <button className="absolute right-3 top-1/2 -translate-y-1/2 h-8 w-8 rounded-md hover:bg-slate-100 flex items-center justify-center text-slate-400">
            <EyeOff className="w-4 h-4" strokeWidth={2.1}/>
          </button>
        </div>
        <div className="flex items-center justify-between mb-7 text-[13px]">
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="w-4 h-4 rounded border-2 border-mipiace-coral bg-mipiace-coral flex items-center justify-center"><Check className="w-3 h-3 text-white" strokeWidth={3}/></span>
            <span className="text-mipiace-ink font-medium">Recuérdame</span>
          </label>
          <a href="#" className="text-mipiace-coral-dark font-medium hover:underline">¿Olvidaste tu contraseña?</a>
        </div>
        <Button className="w-full h-14 bg-mipiace-coral hover:bg-mipiace-coral-dark text-white font-medium text-[15px] rounded-2xl">
          Entrar
        </Button>
        <div className="mt-7 pt-5 border-t border-slate-100 text-center text-[13px] text-slate-500">
          ¿Aún no tienes cuenta? <a href="#" className="text-mipiace-coral-dark font-medium hover:underline">Regístrate</a>
        </div>
      </div>
      <div className="text-center mt-6 text-[11.5px] text-slate-400">mipiacetpv · admin</div>
    </div>
  </div>
)

// ─────────────────────────────────────────────────────────────────────
// SCREEN 9: Admin — Mi cuenta
// ─────────────────────────────────────────────────────────────────────
const AdminAccountScreen = () => (
  <div className="min-h-screen bg-mipiace-stone flex font-sans">
    <aside className="hidden md:flex w-[240px] shrink-0 border-r border-slate-200 bg-white flex-col px-5 py-6">
      <div className="mb-8"><Logo /></div>
      <nav className="space-y-1.5">
        {[
          { label: "Tiendas", icon: Building2 },
          { label: "Dispositivos", icon: Calculator },
          { label: "Cajeros", icon: Users },
          { label: "Productos", icon: Package },
          { label: "Mi cuenta", icon: User, active: true },
          { label: "Seguridad", icon: Shield },
          { label: "Holded", icon: KeyRound },
        ].map((x: any) => {
          const I = x.icon
          return (
            <button
              key={x.label}
              className={x.active
                ? "w-full h-11 flex items-center gap-3 px-4 rounded-xl bg-mipiace-coral-soft text-mipiace-coral-dark text-[14px] font-medium"
                : "w-full h-11 flex items-center gap-3 px-4 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-mipiace-ink text-[14px] font-medium"
              }
            >
              <I className={x.active ? "w-[17px] h-[17px] text-mipiace-coral" : "w-[17px] h-[17px] text-slate-500"} strokeWidth={2.1}/>
              <span>{x.label}</span>
            </button>
          )
        })}
      </nav>
    </aside>
    <main className="flex-1 min-w-0 overflow-y-auto">
      <header className="h-[72px] border-b border-slate-200 bg-white flex items-center px-5 md:px-8">
        <h1 className="text-[20px] font-semibold text-mipiace-ink tracking-tight">Mi cuenta</h1>
        <div className="ml-auto flex items-center gap-2.5">
          <button className="h-9 px-3 rounded-lg hover:bg-slate-50 text-[13px] text-slate-600 font-medium">Cerrar sesión</button>
          <span className="h-9 w-9 rounded-lg bg-mipiace-ink text-white text-[12.5px] font-medium flex items-center justify-center">MO</span>
        </div>
      </header>
      <div className="p-5 md:p-8 max-w-3xl">
        {/* Datos fiscales */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h2 className="text-[17px] font-semibold text-mipiace-ink tracking-tight">Datos fiscales del negocio</h2>
              <p className="text-[13px] text-slate-500 mt-1">Estos datos van impresos al pie de cada ticket.</p>
            </div>
            <Button variant="outline" className="h-9 text-[13px] border-slate-200">Editar</Button>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4 mt-5">
            <div>
              <div className="text-[11.5px] uppercase tracking-wider text-slate-400 font-medium mb-1">Razón social</div>
              <div className="text-[14.5px] text-mipiace-ink font-medium">Librería Thalia, S.L.</div>
            </div>
            <div>
              <div className="text-[11.5px] uppercase tracking-wider text-slate-400 font-medium mb-1">NIF</div>
              <div className="text-[14.5px] text-mipiace-ink font-medium tabular-nums">B-12345678</div>
            </div>
            <div className="sm:col-span-2">
              <div className="text-[11.5px] uppercase tracking-wider text-slate-400 font-medium mb-1">Dirección</div>
              <div className="text-[14.5px] text-mipiace-ink font-medium">Calle Mayor 47, 28013 Madrid</div>
            </div>
          </div>
        </section>

        {/* Conexión Holded */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
          <h2 className="text-[17px] font-semibold text-mipiace-ink tracking-tight mb-1">Conexión con Holded</h2>
          <p className="text-[13px] text-slate-500 mb-5">El TPV se sincroniza cada 15 minutos con tu cuenta Holded.</p>
          <div className="bg-mipiace-stone rounded-xl p-4 flex items-center gap-4 mb-4">
            <span className="h-10 w-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center"><Check className="w-5 h-5" strokeWidth={2.5}/></span>
            <div className="flex-1">
              <div className="text-[14.5px] font-medium text-mipiace-ink">Conectada correctamente</div>
              <div className="text-[12.5px] text-slate-500 mt-0.5">Última sincronización hace 3 min · 75 productos, 24 servicios</div>
            </div>
            <span className="text-[12px] text-emerald-700 font-medium uppercase tracking-wider px-2.5 py-1 rounded-lg bg-emerald-100">Activa</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-2.5">
            <Button variant="outline" className="h-11 border-slate-200 gap-2"><RotateCcw className="w-3.5 h-3.5"/>Probar conexión</Button>
            <Button variant="outline" className="h-11 border-slate-200 gap-2"><KeyRound className="w-3.5 h-3.5"/>Cambiar API Key</Button>
          </div>
        </section>

        {/* 2FA */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h2 className="text-[17px] font-semibold text-mipiace-ink tracking-tight mb-1">Verificación en dos pasos</h2>
              <p className="text-[13px] text-slate-500 mb-4 max-w-md">
                Añade una capa extra de seguridad. Pediremos un código TOTP de tu app autenticadora al iniciar sesión.
              </p>
              <div className="flex items-center gap-2 text-[12.5px] text-amber-700">
                <AlertCircle className="w-3.5 h-3.5"/>
                <span>Recomendado: tu API Key de Holded está conectada.</span>
              </div>
            </div>
            <Button className="h-10 bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[13.5px] rounded-xl ml-4">Activar 2FA</Button>
          </div>
        </section>

        {/* Sesiones */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7">
          <h2 className="text-[17px] font-semibold text-mipiace-ink tracking-tight mb-1">Sesiones activas</h2>
          <p className="text-[13px] text-slate-500 mb-5">Dispositivos donde tu cuenta de admin está activa.</p>
          <div className="space-y-2.5">
            {[
              { device: "MacBook Pro · Safari", location: "Madrid, España", time: "Ahora mismo", current: true },
              { device: "iPhone 15 · Safari mobile", location: "Madrid, España", time: "Hace 2 días", current: false },
            ].map(s => (
              <div key={s.device} className="flex items-center gap-4 p-4 rounded-xl border border-slate-100">
                <span className="h-10 w-10 rounded-xl bg-mipiace-stone text-mipiace-ink flex items-center justify-center"><Calculator className="w-4 h-4" strokeWidth={2.1}/></span>
                <div className="flex-1">
                  <div className="text-[14px] font-medium text-mipiace-ink flex items-center gap-2">
                    {s.device}
                    {s.current && <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded font-semibold">esta</span>}
                  </div>
                  <div className="text-[12.5px] text-slate-500 mt-0.5">{s.location} · {s.time}</div>
                </div>
                {!s.current && <button className="text-[13px] text-mipiace-coral-dark hover:underline font-medium">Cerrar</button>}
              </div>
            ))}
          </div>
          <button className="mt-4 text-[13px] text-slate-500 hover:text-mipiace-coral-dark font-medium">Cerrar todas las demás sesiones</button>
        </section>
      </div>
    </main>
  </div>
)

// ─────────────────────────────────────────────────────────────────────
// Screen registry + selector
// ─────────────────────────────────────────────────────────────────────
const screens = [
  { id: "tpv-pair", label: "Emparejamiento", group: "TPV", component: TpvPairScreen },
  { id: "tpv-pin", label: "Login cajero (PIN)", group: "TPV", component: TpvPinScreen },
  { id: "tpv-shift", label: "Apertura turno", group: "TPV", component: TpvShiftOpenScreen },
  { id: "tpv-sale", label: "Venta rápida", group: "TPV", component: TpvSaleScreen },
  { id: "tpv-map", label: "Mapa de sala", group: "TPV", component: TpvMapScreen },
  { id: "tpv-table", label: "Mesa abierta", group: "TPV", component: TpvTableScreen },
  { id: "tpv-checkout", label: "Cobro", group: "TPV", component: TpvCheckoutScreen },
  { id: "admin-login", label: "Login", group: "Admin", component: AdminLoginScreen },
  { id: "admin-account", label: "Mi cuenta", group: "Admin", component: AdminAccountScreen },
]

export default function App() {
  const [screenId, setScreenId] = useState("tpv-sale")
  const screen = screens.find(s => s.id === screenId) ?? screens[3]
  const ScreenComp = screen.component
  return (
    <div className="font-sans">
      <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 bg-white border border-slate-200 rounded-2xl shadow-lg shadow-slate-900/5 px-2 py-2 flex items-center gap-1 max-w-[calc(100vw-1rem)] overflow-x-auto">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-2 shrink-0">Preview</span>
        {screens.map(s => (
          <button
            key={s.id}
            onClick={() => setScreenId(s.id)}
            className={
              s.id === screenId
                ? "px-3 py-1.5 rounded-xl bg-mipiace-ink text-white text-[12px] font-medium whitespace-nowrap"
                : "px-3 py-1.5 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-mipiace-ink text-[12px] font-medium whitespace-nowrap"
            }
            title={`${s.group} · ${s.label}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="pt-20">
        <ScreenComp />
      </div>
    </div>
  )
}
