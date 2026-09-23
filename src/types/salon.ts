export interface SalonService {
  id: string;
  name: string;
  category: 'Bridal & Makeup' | 'Hair Styling & Care' | 'Skin & Facials' | 'Nails & Feet' | 'Spa & Body' | 'Waxing & Threading';
  price: number;
  durationMinutes: number;
  description: string;
  popular?: boolean;
  tier?: 'Classic' | 'Signature' | 'Luxury Royal';
  image?: string;
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
}

export interface GalleryWork {
  id: string;
  title: string;
  artistId: string;
  artistName: string;
  mediaType: 'image' | 'video';
  mediaUrl: string;
  thumbnailUrl?: string;
  category: 'Bridal' | 'Party Makeup' | 'Hair Styling' | 'Facial Glow' | 'Nail Art' | 'Reception';
  description: string;
  tags: string[];
  likes: number;
  createdAt: string;
  featured?: boolean;
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
  status: 'confirmed' | 'pending' | 'completed' | 'cancelled';
  bookedBy: 'customer' | 'staff';
  totalAmount: number;
  createdAt: string;
}

export interface BillItem {
  id: string;
  name: string;
  type: 'service' | 'product';
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
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  tipAmount: number;
  grandTotal: number;
  paymentMode: 'UPI' | 'Credit/Debit Card' | 'Cash' | 'Net Banking';
  paymentStatus: 'Paid' | 'Pending';
  staffName: string;
  createdAt: string;
  notes?: string;
}

export interface CustomerEnquiry {
  id: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  serviceOfInterest: string;
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
