import { useState, useEffect, useCallback } from 'react';

export type PublicRoute = 
  | 'home' 
  | 'services' 
  | 'book' 
  | 'artists' 
  | 'gallery' 
  | 'contact' 
  | 'enquiry';

export type AdminRoute = 
  | 'login'
  | 'dashboard'
  | 'appointments'
  | 'customers'
  | 'customer-detail'
  | 'services'
  | 'staff'
  | 'billing'
  | 'feedback'
  | 'gallery'
  | 'enquiries'
  | 'whatsapp'
  | 'settings';

export interface RouteState {
  isAdminRoute: boolean;
  isStaffRoute: boolean;
  subRoute: AdminRoute | null;
  publicPage: PublicRoute;
  customerId?: string;
  path: string;
}

export function parseRoute(pathname: string): RouteState {
  const clean = pathname.replace(/\/+$/, '') || '/';

  // 1. STAFF PORTAL ROUTES (/staff/*)
  if (clean.startsWith('/staff')) {
    if (clean === '/staff/login') {
      return {
        isAdminRoute: false,
        isStaffRoute: true,
        subRoute: 'login',
        publicPage: 'home',
        path: clean,
      };
    }
    const parts = clean.split('/').filter(Boolean);
    const second = (parts[1] || 'billing').toLowerCase() as AdminRoute;
    return {
      isAdminRoute: false,
      isStaffRoute: true,
      subRoute: second === 'appointments' ? 'appointments' : 'billing',
      publicPage: 'home',
      path: clean,
    };
  }

  // 2. ADMIN PORTAL ROUTES (/admin/*)
  if (clean.startsWith('/admin')) {
    if (clean === '/admin') {
      return {
        isAdminRoute: true,
        isStaffRoute: false,
        subRoute: 'dashboard',
        publicPage: 'home',
        path: clean,
      };
    }

    const parts = clean.split('/').filter(Boolean);
    const second = parts[1]?.toLowerCase();
    const third = parts[2];

    if (second === 'login') {
      return { isAdminRoute: true, isStaffRoute: false, subRoute: 'login', publicPage: 'home', path: clean };
    }
    if (second === 'dashboard') {
      return { isAdminRoute: true, isStaffRoute: false, subRoute: 'dashboard', publicPage: 'home', path: clean };
    }
    if (second === 'appointments') {
      return { isAdminRoute: true, isStaffRoute: false, subRoute: 'appointments', publicPage: 'home', path: clean };
    }
    if (second === 'customers') {
      if (third) {
        return { isAdminRoute: true, isStaffRoute: false, subRoute: 'customer-detail', customerId: third, publicPage: 'home', path: clean };
      }
      return { isAdminRoute: true, isStaffRoute: false, subRoute: 'customers', publicPage: 'home', path: clean };
    }
    if (second === 'services') {
      return { isAdminRoute: true, isStaffRoute: false, subRoute: 'services', publicPage: 'home', path: clean };
    }
    if (second === 'staff') {
      return { isAdminRoute: true, isStaffRoute: false, subRoute: 'staff', publicPage: 'home', path: clean };
    }
    if (second === 'billing' || second === 'pos' || second === 'orders') {
      return { isAdminRoute: true, isStaffRoute: false, subRoute: 'billing', publicPage: 'home', path: clean };
    }
    if (second === 'feedback') {
      return { isAdminRoute: true, isStaffRoute: false, subRoute: 'feedback', publicPage: 'home', path: clean };
    }
    if (second === 'gallery') {
      return { isAdminRoute: true, isStaffRoute: false, subRoute: 'gallery', publicPage: 'home', path: clean };
    }
    if (second === 'enquiries' || second === 'leads') {
      return { isAdminRoute: true, isStaffRoute: false, subRoute: 'enquiries', publicPage: 'home', path: clean };
    }
    if (second === 'whatsapp') {
      return { isAdminRoute: true, isStaffRoute: false, subRoute: 'whatsapp', publicPage: 'home', path: clean };
    }
    if (second === 'settings' || second === 'printer') {
      return { isAdminRoute: true, isStaffRoute: false, subRoute: 'settings', publicPage: 'home', path: clean };
    }

    return { isAdminRoute: true, isStaffRoute: false, subRoute: 'dashboard', publicPage: 'home', path: clean };
  }

  // 3. PUBLIC CUSTOMER ROUTES
  let publicPage: PublicRoute = 'home';
  if (clean === '/services') {
    publicPage = 'services';
  } else if (clean === '/book') {
    publicPage = 'book';
  } else if (clean === '/artists') {
    publicPage = 'artists';
  } else if (clean === '/gallery') {
    publicPage = 'gallery';
  } else if (clean === '/contact') {
    publicPage = 'contact';
  } else if (clean === '/enquiry') {
    publicPage = 'enquiry';
  }

  return {
    isAdminRoute: false,
    isStaffRoute: false,
    subRoute: null,
    publicPage,
    path: clean,
  };
}

export function useAdminRouter() {
  const [routeState, setRouteState] = useState<RouteState>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const handlePopState = () => {
      setRouteState(parseRoute(window.location.pathname));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((to: string, replace = false) => {
    if (replace) {
      window.history.replaceState(null, '', to);
    } else {
      window.history.pushState(null, '', to);
    }
    setRouteState(parseRoute(to));
    window.scrollTo(0, 0);
  }, []);

  return {
    ...routeState,
    navigate,
  };
}
