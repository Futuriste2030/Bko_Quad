/* Icônes Lucide (lucide-react), trait 2px, 24px. Même API partout. */
import {
  Bell, Bike, Calendar, Check, ChevronRight, ClipboardCheck, Clock, Car, Bus, Motorbike, Truck,
  Download, FileText, Home, Info, LogOut, Menu, Moon, Phone, Plus, RefreshCw,
  ScanLine,
  Search, Send, Settings, Sun, Ticket, ChartColumn, User, Users,
  Wallet, X, TriangleAlert, type LucideIcon,
} from 'lucide-react';
import type { CSSProperties } from 'react';

export type IconName =
  | 'home' | 'calendar' | 'ticket' | 'phone' | 'cash' | 'close'
  | 'users' | 'settings' | 'user' | 'logout' | 'sun' | 'moon'
  | 'plus' | 'search' | 'bell' | 'check' | 'alert' | 'info'
  | 'clock' | 'wallet' | 'chart' | 'x' | 'chevR' | 'send'
  | 'refresh' | 'file' | 'menu' | 'quad' | 'scan' | 'download'
  | 'moto' | 'velo' | 'bus' | 'car' | 'truck';

const MAP: Record<IconName, LucideIcon> = {
  home: Home,
  calendar: Calendar,
  ticket: Ticket,
  phone: Phone,
  cash: Wallet,
  close: ClipboardCheck,
  users: Users,
  settings: Settings,
  user: User,
  logout: LogOut,
  sun: Sun,
  moon: Moon,
  plus: Plus,
  search: Search,
  bell: Bell,
  check: Check,
  alert: TriangleAlert,
  info: Info,
  clock: Clock,
  wallet: Wallet,
  chart: ChartColumn,
  x: X,
  chevR: ChevronRight,
  send: Send,
  refresh: RefreshCw,
  file: FileText,
  menu: Menu,
  quad: Motorbike,
  scan: ScanLine,
  download: Download,
  moto: Motorbike,
  velo: Bike,
  bus: Bus,
  car: Car,
  truck: Truck,
};

export default function Icon({ name, size = 22, className, style }: {
  name: IconName; size?: number; className?: string; style?: CSSProperties;
}) {
  const C = MAP[name];
  return <C size={size} strokeWidth={2} className={className} style={style} aria-hidden="true" focusable="false" />;
}
