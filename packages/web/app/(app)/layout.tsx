import { Sidebar } from '@/components/Sidebar';

// Оболочка дашборда: левый рельс + контент.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
