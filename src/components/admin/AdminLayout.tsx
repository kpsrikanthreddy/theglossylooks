import React, { useState } from 'react';
import { 
  Sparkles, 
  LayoutDashboard, 
  Calendar, 
  Users, 
  Scissors, 
  UserCheck, 
  Receipt, 
  MessageSquareHeart, 
  Image as GalleryIcon, 
  HelpCircle, 
  MessageCircle, 
  Settings as SettingsIcon, 
  LogOut, 
  Menu, 
  X, 
  ExternalLink,
  Shield,
  Bell
} from 'lucide-react';
import { AdminRole, AdminUser } from '../../types/admin';
import { AdminRoute } from '../../hooks/useAdminRouter';

interface AdminLayoutProps {
  currentUser: AdminUser;
  currentRoute: AdminRoute;
  onNavigate: (route: AdminRoute) => void;
  onLogout: () => void;
  onViewPublicSite: () => void;
  pendingEnquiriesCount?: number;
  badFeedbackCount?: number;
  children: React.ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({
  currentUser,
  currentRoute,
  onNavigate,
  onLogout,
  onViewPublicSite,
  pendingEnquiriesCount = 0,
  badFeedbackCount = 0,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const getRoleBadge = (role: AdminRole) => {
    switch (role) {
      case 'SUPER_ADMIN':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">SUPER ADMIN</span>;
      case 'SALON_ADMIN':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#8C3A42]/15 text-[#8C3A42] border border-[#8C3A42]/20">SALON ADMIN</span>;
      case 'RECEPTIONIST':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">RECEPTIONIST</span>;
      case 'STAFF':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">STAFF / ARTIST</span>;
    }
  };

  const navItems: {
    id: AdminRoute;
    label: string;
    icon: React.ElementType;
    badge?: number;
    badgeColor?: string;
    roles?: AdminRole[];
  }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'appointments', label: 'Appointments', icon: Calendar },
    { id: 'customers', label: 'Customers', icon: Users, roles: ['SUPER_ADMIN', 'SALON_ADMIN', 'RECEPTIONIST'] },
    { id: 'services', label: 'Services Menu', icon: Scissors, roles: ['SUPER_ADMIN', 'SALON_ADMIN'] },
    { id: 'staff', label: 'Staff / Artists', icon: UserCheck, roles: ['SUPER_ADMIN', 'SALON_ADMIN'] },
    { id: 'billing', label: 'Billing / Orders', icon: Receipt, roles: ['SUPER_ADMIN', 'SALON_ADMIN', 'RECEPTIONIST'] },
    { 
      id: 'feedback', 
      label: 'Customer Feedback', 
      icon: MessageSquareHeart, 
      badge: badFeedbackCount > 0 ? badFeedbackCount : undefined,
      badgeColor: 'bg-rose-500 text-white',
      roles: ['SUPER_ADMIN', 'SALON_ADMIN', 'RECEPTIONIST']
    },
    { id: 'gallery', label: 'Gallery Works', icon: GalleryIcon },
    { 
      id: 'enquiries', 
      label: 'Enquiries', 
      icon: HelpCircle, 
      badge: pendingEnquiriesCount > 0 ? pendingEnquiriesCount : undefined,
      badgeColor: 'bg-amber-500 text-white',
      roles: ['SUPER_ADMIN', 'SALON_ADMIN', 'RECEPTIONIST']
    },
    { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, roles: ['SUPER_ADMIN', 'SALON_ADMIN'] },
    { id: 'settings', label: 'Settings', icon: SettingsIcon, roles: ['SUPER_ADMIN', 'SALON_ADMIN'] },
  ];

  // Filter items visible for user's role
  const visibleNavItems = navItems.filter(item => {
    if (!item.roles) return true;
    return item.roles.includes(currentUser.role);
  });

  const handleNavClick = (route: AdminRoute) => {
    onNavigate(route);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#F7F4F2] flex flex-col lg:flex-row text-[#2D2424]">

      {/* MOBILE TOP BAR */}
      <div className="lg:hidden bg-[#2D2424] text-white px-4 py-3 flex items-center justify-between sticky top-0 z-40 shadow-md">
        <div className="flex items-center gap-2">
          <button 
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="p-1.5 rounded-lg hover:bg-white/10 text-white"
            aria-label="Open navigation menu"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div>
            <div className="font-serif text-lg leading-tight font-semibold flex items-center gap-1.5">
              <span>The Glossy Looks</span>
              <Sparkles className="w-3.5 h-3.5 text-[#E8C5C8]" />
            </div>
            <div className="text-[10px] text-[#E8C5C8] uppercase tracking-wider">Admin Portal</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {getRoleBadge(currentUser.role)}
          <button
            type="button"
            onClick={onLogout}
            title="Log Out"
            className="p-1.5 text-stone-400 hover:text-white hover:bg-white/10 rounded-lg"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* MOBILE DRAWER BACKDROP */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-50 lg:hidden backdrop-blur-xs transition-opacity"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* SIDEBAR NAVIGATION (Desktop persistent & Mobile slide-over) */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-72 bg-[#2D2424] text-white flex flex-col
        transition-transform duration-300 ease-in-out lg:static lg:translate-x-0
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        
        {/* Brand & Studio Location */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[#8C3A42] flex items-center justify-center text-white">
                <Sparkles className="w-4 h-4 text-[#E8C5C8]" />
              </div>
              <div>
                <h1 className="font-serif text-lg font-bold tracking-wide">The Glossy Looks</h1>
                <p className="text-[10px] uppercase tracking-widest text-[#E8C5C8]">Gachibowli, Hyderabad</p>
              </div>
            </div>
          </div>
          <button 
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden text-stone-400 hover:text-white p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current User Quick Card */}
        <div className="px-5 py-4 bg-white/5 border-b border-white/10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#8C3A42]/40 border border-[#8C3A42] text-[#E8C5C8] flex items-center justify-center font-bold text-sm shrink-0">
            {currentUser.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-xs text-white truncate">{currentUser.name}</div>
            <div className="text-[10px] text-stone-400 truncate">{currentUser.email}</div>
            <div className="mt-1">{getRoleBadge(currentUser.role)}</div>
          </div>
        </div>

        {/* Nav Links */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {visibleNavItems.map(item => {
            const Icon = item.icon;
            const isActive = currentRoute === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className={`
                  w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all
                  ${isActive 
                    ? 'bg-[#8C3A42] text-white shadow-md shadow-[#8C3A42]/30 font-semibold' 
                    : 'text-stone-300 hover:bg-white/10 hover:text-white'}
                `}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#E8C5C8]' : 'text-stone-400'}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge !== undefined && (
                  <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full ${item.badgeColor || 'bg-stone-700 text-white'}`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-white/10 space-y-2">
          <button
            type="button"
            onClick={onViewPublicSite}
            className="w-full py-2 px-3 rounded-lg text-xs font-medium text-stone-300 hover:text-white hover:bg-white/10 flex items-center justify-center gap-2 border border-white/10"
          >
            <ExternalLink className="w-3.5 h-3.5 text-[#E8C5C8]" />
            <span>View Public Website</span>
          </button>

          <button
            type="button"
            onClick={onLogout}
            className="w-full py-2 px-3 rounded-lg text-xs font-medium text-rose-300 hover:text-white hover:bg-rose-900/30 flex items-center justify-center gap-2"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>

      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* TOP DESKTOP HEADER */}
        <header className="hidden lg:flex bg-white border-b border-stone-200 px-8 py-4 items-center justify-between sticky top-0 z-30 shadow-xs">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-widest text-[#8C3A42] font-semibold">The Glossy Looks</span>
              <span className="text-stone-300">•</span>
              <span className="text-xs text-stone-500 font-medium">Vinayak Nagar, Gachibowli</span>
            </div>
            <h2 className="text-xl font-bold font-serif text-[#2D2424] capitalize">
              {currentRoute === 'customer-detail' ? 'Customer Profile' : currentRoute.replace('-', ' ')}
            </h2>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onViewPublicSite}
              className="text-xs font-medium text-stone-600 hover:text-[#8C3A42] flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 hover:border-[#8C3A42]/30 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Visit Salon Website</span>
            </button>

            <div className="h-6 w-px bg-stone-200" />

            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#8C3A42]/10 text-[#8C3A42] font-bold text-xs flex items-center justify-center border border-[#8C3A42]/20">
                {currentUser.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="text-xs font-semibold text-[#2D2424]">{currentUser.name}</div>
                <div>{getRoleBadge(currentUser.role)}</div>
              </div>
            </div>
          </div>
        </header>

        {/* MAIN BODY VIEW */}
        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto">
          {children}
        </main>

      </div>

    </div>
  );
};
