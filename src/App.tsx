/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  SalonService, 
  Artist, 
  GalleryWork, 
  Appointment, 
  BillOrder, 
  CustomerEnquiry, 
  RetailProduct 
} from './types/salon';
import { 
  INITIAL_SERVICES, 
  INITIAL_ARTISTS, 
  INITIAL_GALLERY, 
  INITIAL_APPOINTMENTS, 
  INITIAL_BILLS, 
  INITIAL_ENQUIRIES, 
  INITIAL_RETAIL_PRODUCTS 
} from './data/initialData';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { ServicesMenu } from './components/ServicesMenu';
import { ArtistsSection } from './components/ArtistsSection';
import { GallerySection } from './components/GallerySection';
import { EnquirySection } from './components/EnquirySection';
import { ContactAndMap } from './components/ContactAndMap';
import { AppointmentBookingModal } from './components/AppointmentBookingModal';
import { AdminPanel } from './components/AdminPanel';
import { InvoiceModal } from './components/InvoiceModal';
import { WhatsAppWidget } from './components/WhatsAppWidget';
import { Footer } from './components/Footer';

export default function App() {
  // Navigation & View Mode State
  const [activeTab, setActiveTab] = useState<'customer' | 'admin'>('customer');
  const [activeSection, setActiveSection] = useState<string>('hero');

  // Core Data Collections (with localStorage persistence)
  const [services, setServices] = useState<SalonService[]>(() => {
    try {
      const saved = localStorage.getItem('glossy_services');
      return saved ? JSON.parse(saved) : INITIAL_SERVICES;
    } catch {
      return INITIAL_SERVICES;
    }
  });

  const [artists] = useState<Artist[]>(INITIAL_ARTISTS);

  const [galleryItems, setGalleryItems] = useState<GalleryWork[]>(() => {
    try {
      const saved = localStorage.getItem('glossy_gallery');
      return saved ? JSON.parse(saved) : INITIAL_GALLERY;
    } catch {
      return INITIAL_GALLERY;
    }
  });

  const [appointments, setAppointments] = useState<Appointment[]>(() => {
    try {
      const saved = localStorage.getItem('glossy_appointments');
      return saved ? JSON.parse(saved) : INITIAL_APPOINTMENTS;
    } catch {
      return INITIAL_APPOINTMENTS;
    }
  });

  const [bills, setBills] = useState<BillOrder[]>(() => {
    try {
      const saved = localStorage.getItem('glossy_bills');
      return saved ? JSON.parse(saved) : INITIAL_BILLS;
    } catch {
      return INITIAL_BILLS;
    }
  });

  const [enquiries, setEnquiries] = useState<CustomerEnquiry[]>(() => {
    try {
      const saved = localStorage.getItem('glossy_enquiries');
      return saved ? JSON.parse(saved) : INITIAL_ENQUIRIES;
    } catch {
      return INITIAL_ENQUIRIES;
    }
  });

  const [retailProducts] = useState<RetailProduct[]>(INITIAL_RETAIL_PRODUCTS);

  // Modals & Flow States
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [preselectedService, setPreselectedService] = useState<SalonService | null>(null);
  const [preselectedArtist, setPreselectedArtist] = useState<Artist | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<BillOrder | null>(null);
  const [galleryArtistFilter, setGalleryArtistFilter] = useState<string>('All');

  // Sync to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('glossy_services', JSON.stringify(services));
    } catch (e) {
      console.error(e);
    }
  }, [services]);

  useEffect(() => {
    try {
      localStorage.setItem('glossy_gallery', JSON.stringify(galleryItems));
    } catch (e) {
      console.error(e);
    }
  }, [galleryItems]);

  useEffect(() => {
    try {
      localStorage.setItem('glossy_appointments', JSON.stringify(appointments));
    } catch (e) {
      console.error(e);
    }
  }, [appointments]);

  useEffect(() => {
    try {
      localStorage.setItem('glossy_bills', JSON.stringify(bills));
    } catch (e) {
      console.error(e);
    }
  }, [bills]);

  useEffect(() => {
    try {
      localStorage.setItem('glossy_enquiries', JSON.stringify(enquiries));
    } catch (e) {
      console.error(e);
    }
  }, [enquiries]);

  // Handlers
  const handleOpenBooking = (service?: SalonService, artist?: Artist) => {
    setPreselectedService(service || null);
    setPreselectedArtist(artist || null);
    setBookingModalOpen(true);
  };

  const handleAppointmentCreated = (appointment: Appointment) => {
    setAppointments((prev) => [appointment, ...prev]);
  };

  const handleAddGalleryWork = (work: GalleryWork) => {
    setGalleryItems((prev) => [work, ...prev]);
  };

  const handleDeleteGalleryWork = (id: string) => {
    setGalleryItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleUpdateAppointmentStatus = (id: string, status: Appointment['status']) => {
    setAppointments((prev) =>
      prev.map((apt) => (apt.id === id ? { ...apt, status } : apt))
    );
  };

  const handleCreateBill = (bill: BillOrder) => {
    setBills((prev) => [bill, ...prev]);
  };

  const handleUpdateEnquiry = (id: string, status: CustomerEnquiry['status'], followUpNotes?: string) => {
    setEnquiries((prev) =>
      prev.map((enq) => (enq.id === id ? { ...enq, status, followUpNotes: followUpNotes || enq.followUpNotes } : enq))
    );
  };

  const handleAddService = (service: SalonService) => {
    setServices((prev) => [...prev, service]);
  };

  const handleScrollToSection = (sectionId: string) => {
    setActiveTab('customer');
    setActiveSection(sectionId);
    setTimeout(() => {
      const el = document.getElementById(sectionId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      }
    }, 50);
  };

  const handleFilterGalleryByArtist = (artistName: string) => {
    setGalleryArtistFilter(artistName);
    handleScrollToSection('gallery');
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF7F5] selection:bg-[#E8C5C8] selection:text-[#3B1E22]">
      
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenBooking={() => handleOpenBooking()}
        activeSection={activeSection}
        setActiveSection={setActiveSection}
        appointmentCount={appointments.length}
      />

      {/* Main Body */}
      {activeTab === 'admin' ? (
        /* Salon Staff & Artist Suite */
        <main className="flex-1">
          <AdminPanel
            services={services}
            artists={artists}
            galleryItems={galleryItems}
            appointments={appointments}
            bills={bills}
            enquiries={enquiries}
            retailProducts={retailProducts}
            onAddGalleryWork={handleAddGalleryWork}
            onDeleteGalleryWork={handleDeleteGalleryWork}
            onUpdateAppointmentStatus={handleUpdateAppointmentStatus}
            onAddAppointment={() => handleOpenBooking()}
            onCreateBill={handleCreateBill}
            onUpdateEnquiry={handleUpdateEnquiry}
            onAddService={handleAddService}
            onViewInvoice={(bill) => setViewingInvoice(bill)}
            onCloseAdmin={() => setActiveTab('customer')}
          />
        </main>
      ) : (
        /* Customer-Facing Salon Website */
        <main className="flex-1">
          {/* Hero Section */}
          <Hero
            onOpenBooking={() => handleOpenBooking()}
            onExploreMenu={() => handleScrollToSection('menu')}
            onViewGallery={() => handleScrollToSection('gallery')}
            onOpenAdmin={() => setActiveTab('admin')}
          />

          {/* Complete Services Menu */}
          <ServicesMenu
            services={services}
            onSelectForBooking={(srv) => handleOpenBooking(srv)}
            onAddToBill={(srv) => {
              setActiveTab('admin');
              // Let user finish in POS
            }}
          />

          {/* Master Stylists & Artists */}
          <ArtistsSection
            artists={artists}
            onBookWithArtist={(art) => handleOpenBooking(undefined, art)}
            onFilterGalleryByArtist={handleFilterGalleryByArtist}
          />

          {/* Portfolio & Works Gallery */}
          <GallerySection
            galleryItems={galleryItems}
            artists={artists}
            selectedArtistFilter={galleryArtistFilter}
            onSelectArtistFilter={setGalleryArtistFilter}
            onBookThisLook={(work) => {
              const matchedArtist = artists.find((a) => a.id === work.artistId || a.name === work.artistName);
              handleOpenBooking(undefined, matchedArtist);
            }}
            onOpenUploadInAdmin={() => setActiveTab('admin')}
          />

          {/* Customer Enquiries & Consultations */}
          <EnquirySection
            onEnquirySubmitted={(enq) => setEnquiries((prev) => [enq, ...prev])}
          />

          {/* Contact Us & Google Maps Integration */}
          <ContactAndMap />
        </main>
      )}

      {/* Footer */}
      <Footer
        onNavigate={handleScrollToSection}
        onOpenBooking={() => handleOpenBooking()}
        onOpenAdmin={() => setActiveTab('admin')}
      />

      {/* Booking Modal */}
      <AppointmentBookingModal
        isOpen={bookingModalOpen}
        onClose={() => setBookingModalOpen(false)}
        services={services}
        artists={artists}
        initialSelectedService={preselectedService}
        initialSelectedArtist={preselectedArtist}
        onAppointmentCreated={handleAppointmentCreated}
        defaultRole={activeTab === 'admin' ? 'staff' : 'customer'}
      />

      {/* Invoice View Modal */}
      <InvoiceModal
        bill={viewingInvoice}
        onClose={() => setViewingInvoice(null)}
      />

      {/* Floating WhatsApp Concierge Widget */}
      <WhatsAppWidget />

    </div>
  );
}
