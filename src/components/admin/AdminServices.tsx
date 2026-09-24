import React, { useState } from 'react';
import { 
  Scissors, 
  Plus, 
  Search, 
  Edit3, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  IndianRupee, 
  Sparkles,
  X,
  Eye,
  EyeOff
} from 'lucide-react';
import { SalonService } from '../../types/salon';

interface AdminServicesProps {
  services: SalonService[];
  onAddService: (service: SalonService) => void;
  onUpdateService: (service: SalonService) => void;
  onDeleteService: (id: string) => void;
}

export const AdminServices: React.FC<AdminServicesProps> = ({
  services,
  onAddService,
  onUpdateService,
  onDeleteService,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [editingService, setEditingService] = useState<SalonService | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<SalonService['category']>('Bridal & Makeup');
  const [formPrice, setFormPrice] = useState<number>(2500);
  const [formOriginalPrice, setFormOriginalPrice] = useState<number>(3000);
  const [formDuration, setFormDuration] = useState<number>(60);
  const [formDescription, setFormDescription] = useState('');
  const [formImage, setFormImage] = useState('');
  const [formActive, setFormActive] = useState<boolean>(true);
  const [formDisplayOrder, setFormDisplayOrder] = useState<number>(1);
  const [formTier, setFormTier] = useState<SalonService['tier']>('Classic');

  const categories: SalonService['category'][] = [
    'Bridal & Makeup',
    'Hair Styling & Care',
    'Skin & Facials',
    'Nails & Feet',
    'Spa & Body',
    'Waxing & Threading',
  ];

  const handleOpenAdd = () => {
    setIsAddingNew(true);
    setEditingService(null);
    setFormName('');
    setFormCategory('Bridal & Makeup');
    setFormPrice(2500);
    setFormOriginalPrice(3000);
    setFormDuration(60);
    setFormDescription('');
    setFormImage('https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&w=600&q=80');
    setFormActive(true);
    setFormDisplayOrder(services.length + 1);
    setFormTier('Signature');
  };

  const handleOpenEdit = (srv: SalonService) => {
    setEditingService(srv);
    setIsAddingNew(false);
    setFormName(srv.name);
    setFormCategory(srv.category);
    setFormPrice(srv.price);
    setFormOriginalPrice(srv.originalPrice || srv.price);
    setFormDuration(srv.durationMinutes);
    setFormDescription(srv.description);
    setFormImage(srv.image || '');
    setFormActive(srv.active !== false);
    setFormDisplayOrder(srv.displayOrder || 1);
    setFormTier(srv.tier || 'Classic');
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (isAddingNew) {
      const newService: SalonService = {
        id: 'srv-' + Date.now(),
        name: formName.trim(),
        category: formCategory,
        price: Number(formPrice),
        originalPrice: Number(formOriginalPrice),
        offerPrice: Number(formPrice),
        durationMinutes: Number(formDuration),
        description: formDescription.trim(),
        image: formImage.trim() || undefined,
        active: formActive,
        displayOrder: Number(formDisplayOrder),
        tier: formTier,
      };
      onAddService(newService);
      setIsAddingNew(false);
    } else if (editingService) {
      const updated: SalonService = {
        ...editingService,
        name: formName.trim(),
        category: formCategory,
        price: Number(formPrice),
        originalPrice: Number(formOriginalPrice),
        offerPrice: Number(formPrice),
        durationMinutes: Number(formDuration),
        description: formDescription.trim(),
        image: formImage.trim() || undefined,
        active: formActive,
        displayOrder: Number(formDisplayOrder),
        tier: formTier,
      };
      onUpdateService(updated);
      setEditingService(null);
    }
  };

  const handleToggleActive = (srv: SalonService) => {
    const updated: SalonService = {
      ...srv,
      active: srv.active === false ? true : false,
    };
    onUpdateService(updated);
  };

  const filteredServices = services.filter(s => {
    if (selectedCategory !== 'All' && s.category !== selectedCategory) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="space-y-6">

      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-serif font-bold text-[#2D2424]">Salon Menu & Services</h2>
          <p className="text-xs text-stone-500">
            Manage treatments, durations, pricing tiers, and active status. Changes sync instantly to the public site.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenAdd}
          className="px-4 py-2 rounded-xl bg-[#8C3A42] hover:bg-[#722F36] text-white text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Add New Service</span>
        </button>
      </div>

      {/* SEARCH AND CATEGORY FILTER */}
      <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search treatments by name or description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-stone-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#8C3A42] bg-[#FAF7F5]"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <button
            type="button"
            onClick={() => setSelectedCategory('All')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
              selectedCategory === 'All' ? 'bg-[#8C3A42] text-white font-semibold' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            All Categories ({services.length})
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                selectedCategory === cat ? 'bg-[#8C3A42] text-white font-semibold' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* SERVICES TABLE */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#FAF7F5] text-stone-600 uppercase text-[10px] tracking-wider border-b border-stone-200 font-semibold">
              <tr>
                <th className="py-3 px-4">Service</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Duration</th>
                <th className="py-3 px-4">Price</th>
                <th className="py-3 px-4">Tier</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filteredServices.map(srv => {
                const isActive = srv.active !== false;
                return (
                  <tr key={srv.id} className={`hover:bg-stone-50/80 transition-colors ${!isActive ? 'opacity-50 bg-stone-50/40' : ''}`}>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-[#2D2424] flex items-center gap-2">
                        {srv.image && (
                          <img src={srv.image} alt={srv.name} className="w-8 h-8 rounded-lg object-cover shrink-0 border border-stone-200" />
                        )}
                        <div>
                          <div>{srv.name}</div>
                          <div className="text-[11px] text-stone-500 font-normal line-clamp-1">{srv.description}</div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-4 text-stone-600 whitespace-nowrap">
                      {srv.category}
                    </td>

                    <td className="py-3 px-4 text-stone-600 whitespace-nowrap">
                      {srv.durationMinutes} mins
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-bold text-emerald-700">₹{srv.price}</span>
                      {srv.originalPrice && srv.originalPrice > srv.price && (
                        <span className="text-[10px] text-stone-400 line-through ml-1.5">₹{srv.originalPrice}</span>
                      )}
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="text-[10px] px-2 py-0.5 rounded bg-stone-100 text-stone-700 font-medium">
                        {srv.tier || 'Classic'}
                      </span>
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(srv)}
                        title="Click to toggle active on website"
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                          isActive 
                            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' 
                            : 'bg-stone-200 text-stone-600 hover:bg-stone-300'
                        }`}
                      >
                        {isActive ? <CheckCircle2 className="w-3 h-3 text-emerald-600" /> : <XCircle className="w-3 h-3" />}
                        <span>{isActive ? 'ACTIVE' : 'INACTIVE'}</span>
                      </button>
                    </td>

                    <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(srv)}
                        className="p-1.5 rounded hover:bg-stone-100 text-stone-600 cursor-pointer"
                        title="Edit Service"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteService(srv.id)}
                        className="p-1.5 rounded hover:bg-rose-50 text-rose-500 cursor-pointer"
                        title="Delete Service"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ADD / EDIT MODAL */}
      {(isAddingNew || editingService) && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <h3 className="font-serif font-bold text-lg text-[#2D2424]">
                {isAddingNew ? 'Add New Salon Treatment' : 'Edit Service Details'}
              </h3>
              <button 
                type="button"
                onClick={() => {
                  setIsAddingNew(false);
                  setEditingService(null);
                }}
                className="text-stone-400 hover:text-stone-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Service Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 24K Luxury Gold Radiance Facial"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Category *</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as any)}
                    className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                  >
                    {categories.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Tier</label>
                  <select
                    value={formTier}
                    onChange={(e) => setFormTier(e.target.value as any)}
                    className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                  >
                    <option value="Classic">Classic</option>
                    <option value="Signature">Signature</option>
                    <option value="Luxury Royal">Luxury Royal</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Selling Price (₹) *</label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={formPrice}
                    onChange={(e) => setFormPrice(Number(e.target.value))}
                    className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Original Price (₹)</label>
                  <input
                    type="number"
                    min={0}
                    value={formOriginalPrice}
                    onChange={(e) => setFormOriginalPrice(Number(e.target.value))}
                    className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Duration (Min) *</label>
                  <input
                    type="number"
                    required
                    min={15}
                    step={15}
                    value={formDuration}
                    onChange={(e) => setFormDuration(Number(e.target.value))}
                    className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Treatment Description *</label>
                <textarea
                  rows={2}
                  required
                  placeholder="Detail treatment benefits, steps, and skin/hair outcomes..."
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Image URL</label>
                <input
                  type="url"
                  placeholder="https://images.unsplash.com/..."
                  value={formImage}
                  onChange={(e) => setFormImage(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                />
              </div>

              <div className="flex items-center gap-4 pt-1">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-stone-700">
                  <input
                    type="checkbox"
                    checked={formActive}
                    onChange={(e) => setFormActive(e.target.checked)}
                    className="rounded text-[#8C3A42] focus:ring-[#8C3A42]"
                  />
                  <span>Active & Visible on Public Website</span>
                </label>
              </div>

              <div className="pt-3 border-t border-stone-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingNew(false);
                    setEditingService(null);
                  }}
                  className="px-4 py-2 rounded-lg bg-stone-100 text-stone-700 hover:bg-stone-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#8C3A42] text-white hover:bg-[#722F36] font-medium"
                >
                  {isAddingNew ? 'Create Service' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
