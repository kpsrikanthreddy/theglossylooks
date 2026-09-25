export type SalonCategory =
  | 'Threading & Waxing'
  | 'Skin Care & Facials'
  | 'Body Care & Massage'
  | 'Manicure & Pedicure'
  | 'Hair Cut, Wash & Styling'
  | 'Hair Colour'
  | 'Hair Spa & Treatments'
  | 'Pre-Bridal Packages';

export interface SalonService {
  id: string;
  name: string;
  category: SalonCategory | string;
  serviceGroup?: string;
  variantName?: string;
  price: number;
  originalPrice?: number;
  offerPrice?: number;
  durationMinutes: number;
  description: string;
  popular?: boolean;
  tier?: 'Classic' | 'Signature' | 'Luxury Royal';
  image?: string;
  active?: boolean;
  displayOrder?: number;
}

export interface Artist {
  id: string;
  name: string;
  role: string;
  specialty: string;
  avatar: string;
  rating: number;
  experienceYears: number;
  bio: string;
  instagram?: string;
  phone?: string;
  active?: boolean;
}

export interface GalleryWork {
  id: string;
  title: string;
  artistId: string;
  artistName: string;
  mediaType: 'image' | 'video';
  mediaUrl: string;
  url?: string;
  type?: 'image' | 'video';
  thumbnailUrl?: string;
  category: 'Bridal' | 'Party Makeup' | 'Hair Styling' | 'Facial Glow' | 'Nail Art' | 'Reception' | string;
  description: string;
  tags?: string[];
  likes?: number;
  createdAt: string;
  featured?: boolean;
  active?: boolean;
}

export interface Appointment {
  id: string;
  referenceCode: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  serviceIds: string[];
  serviceNames: string[];
  artistId?: string;
  artistName?: string;
  date: string;
  timeSlot: string;
  notes?: string;
  durationMinutes?: number;
  status: 'confirmed' | 'pending' | 'completed' | 'cancelled' | 'in_progress' | 'no_show';
  bookedBy: 'customer' | 'staff';
  totalAmount: number;
  paymentStatus?: 'PAID' | 'PENDING' | 'PARTIAL';
  feedbackStatus?: 'NOT_SENT' | 'SENT' | 'RECEIVED';
  createdAt: string;
}

export interface BillItem {
  id: string;
  name: string;
  type?: 'service' | 'product' | 'custom';
  price: number;
  quantity: number;
  stylistName?: string;
}

export interface BillOrder {
  id: string;
  invoiceNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  items: BillItem[];
  subtotal?: number;
  subTotal?: number;
  discountAmount: number;
  taxAmount: number;
  tipAmount?: number;
  grandTotal: number;
  paymentMode: 'UPI' | 'Credit/Debit Card' | 'Cash' | 'Net Banking' | 'Card' | 'Other';
  paymentStatus: 'Paid' | 'Pending' | 'Partial';
  staffName?: string;
  createdAt: string;
  notes?: string;
}

export interface CustomerEnquiry {
  id: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  serviceOfInterest: string;
  name?: string;
  phone?: string;
  email?: string;
  serviceInterested?: string;
  preferredDate?: string;
  message: string;
  status: 'New' | 'Contacted' | 'Converted' | 'Closed';
  createdAt: string;
  followUpNotes?: string;
}

export interface RetailProduct {
  id: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  stock: number;
  image: string;
}
