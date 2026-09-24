import React, { useState } from 'react';
import { 
  Image as ImageIcon, 
  Video, 
  Plus, 
  Search, 
  Edit3, 
  Trash2, 
  Star, 
  Eye, 
  EyeOff, 
  X, 
  ExternalLink,
  Sparkles
} from 'lucide-react';
import { GalleryWork, Artist } from '../../types/salon';

interface AdminGalleryProps {
  galleryItems: GalleryWork[];
  artists: Artist[];
  onAddWork: (work: GalleryWork) => void;
  onUpdateWork: (work: GalleryWork) => void;
  onDeleteWork: (id: string) => void;
}

export const AdminGallery: React.FC<AdminGalleryProps> = ({
  galleryItems,
  artists,
  onAddWork,
  onUpdateWork,
  onDeleteWork,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [editingWork, setEditingWork] = useState<GalleryWork | null>(null);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formCategory, setFormCategory] = useState('Bridal');
  const [formType, setFormType] = useState<'image' | 'video'>('image');
  const [formUrl, setFormUrl] = useState('');
  const [formArtistId, setFormArtistId] = useState('');
  const [formArtistName, setFormArtistName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formFeatured, setFormFeatured] = useState<boolean>(false);
  const [formVisible, setFormVisible] = useState<boolean>(true);

  const categories = [
    'Bridal',
    'Hair Styling',
    'Makeover',
    'Facials & Glow',
    'Nail Art',
    'Studio & Salon',
  ];

  const handleOpenAdd = () => {
    setIsAddingNew(true);
    setEditingWork(null);
    setFormTitle('');
    setFormCategory('Bridal');
    setFormType('image');
    setFormUrl('https://images.unsplash.com/photo-1594744803329-e58b31de8bf5?auto=format&fit=crop&w=800&q=80');
    setFormArtistId(artists[0]?.id || '');
    setFormArtistName(artists[0]?.name || 'Zainab Qureshi');
    setFormDescription('Radiant HD bridal contouring and bespoke floral hair arrangement.');
    setFormFeatured(true);
    setFormVisible(true);
  };

  const handleOpenEdit = (work: GalleryWork) => {
    setEditingWork(work);
    setIsAddingNew(false);
    setFormTitle(work.title);
    setFormCategory(work.category as any);
    setFormType((work.mediaType || work.type || 'image') as any);
    setFormUrl(work.mediaUrl || work.url || '');
    setFormArtistId(work.artistId || '');
    setFormArtistName(work.artistName || '');
    setFormDescription(work.description || '');
    setFormFeatured(work.featured || false);
    setFormVisible(work.active !== false);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const matchedArtist = artists.find(a => a.id === formArtistId);
    const artistNameFinal = matchedArtist ? matchedArtist.name : formArtistName;

    if (isAddingNew) {
      const newWork: GalleryWork = {
        id: 'gw-' + Date.now(),
        title: formTitle.trim(),
        category: formCategory as any,
        mediaType: formType,
        type: formType,
        mediaUrl: formUrl.trim(),
        url: formUrl.trim(),
        artistId: formArtistId,
        artistName: artistNameFinal,
        description: formDescription.trim(),
        featured: formFeatured,
        active: formVisible,
        createdAt: new Date().toISOString(),
      };
      onAddWork(newWork);
      setIsAddingNew(false);
    } else if (editingWork) {
      const updated: GalleryWork = {
        ...editingWork,
        title: formTitle.trim(),
        category: formCategory as any,
        mediaType: formType,
        type: formType,
        mediaUrl: formUrl.trim(),
        url: formUrl.trim(),
        artistId: formArtistId,
        artistName: artistNameFinal,
        description: formDescription.trim(),
        featured: formFeatured,
        active: formVisible,
      };
      onUpdateWork(updated);
      setEditingWork(null);
    }
  };

  const handleToggleFeatured = (work: GalleryWork) => {
    onUpdateWork({
      ...work,
      featured: !work.featured,
    });
  };

  const handleToggleVisibility = (work: GalleryWork) => {
    onUpdateWork({
      ...work,
      active: work.active === false ? true : false,
    });
  };

  const filteredItems = galleryItems.filter(item => {
    if (selectedCategory !== 'All' && item.category !== selectedCategory) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const matchTitle = item.title.toLowerCase().includes(q);
      const matchArtist = (item.artistName || '').toLowerCase().includes(q);
      if (!matchTitle && !matchArtist) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">

      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-serif font-bold text-[#2D2424]">Gallery & Makeup Artist Portfolio</h2>
          <p className="text-xs text-stone-500">
            Upload images and videos of styling transformations. Live changes sync instantly to the public website gallery.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenAdd}
          className="px-4 py-2 rounded-xl bg-[#8C3A42] hover:bg-[#722F36] text-white text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Upload New Work</span>
        </button>
      </div>

      {/* SEARCH AND FILTERS */}
      <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search gallery works by title or artist..."
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
            All Works ({galleryItems.length})
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

      {/* GALLERY GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {filteredItems.map(item => {
          const isVisible = item.active !== false;

          return (
            <div 
              key={item.id} 
              className={`bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-xs flex flex-col justify-between transition-all ${
                !isVisible ? 'opacity-50' : ''
              }`}
            >
              {/* Media Preview */}
              <div className="relative aspect-4/3 bg-stone-900 group">
                {(item.mediaType === 'video' || item.type === 'video') ? (
                  <video 
                    src={item.mediaUrl || item.url} 
                    className="w-full h-full object-cover" 
                    controls 
                    muted 
                  />
                ) : (
                  <img 
                    src={item.mediaUrl || item.url} 
                    alt={item.title} 
                    className="w-full h-full object-cover" 
                  />
                )}

                {/* Media Type & Featured Badges */}
                <div className="absolute top-2 left-2 flex items-center gap-1">
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-black/60 text-white backdrop-blur-xs flex items-center gap-1">
                    {(item.mediaType === 'video' || item.type === 'video') ? <Video className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />}
                    <span>{(item.mediaType || item.type || 'image').toUpperCase()}</span>
                  </span>
                  {item.featured && (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500 text-white flex items-center gap-1 shadow-xs">
                      <Star className="w-3 h-3 fill-white" />
                      <span>Featured</span>
                    </span>
                  )}
                </div>

                {/* Quick Toggle Controls */}
                <div className="absolute top-2 right-2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleToggleVisibility(item)}
                    title={isVisible ? 'Visible on public site' : 'Hidden from public site'}
                    className="p-1 rounded-md bg-black/60 text-white hover:bg-black/80 backdrop-blur-xs"
                  >
                    {isVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-stone-400" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleFeatured(item)}
                    title={item.featured ? 'Remove from Featured' : 'Mark as Featured'}
                    className="p-1 rounded-md bg-black/60 text-white hover:bg-black/80 backdrop-blur-xs"
                  >
                    <Star className={`w-3.5 h-3.5 ${item.featured ? 'text-amber-400 fill-amber-400' : 'text-stone-300'}`} />
                  </button>
                </div>
              </div>

              {/* Card Details */}
              <div className="p-3.5 space-y-2 flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-[11px] text-stone-400 mb-0.5">
                    <span>{item.category}</span>
                    <span>{item.artistName || 'Salon Artist'}</span>
                  </div>
                  <h4 className="font-semibold text-xs text-[#2D2424] line-clamp-1">{item.title}</h4>
                  {item.description && (
                    <p className="text-[11px] text-stone-500 line-clamp-2 mt-1 italic">
                      "{item.description}"
                    </p>
                  )}
                </div>

                <div className="pt-2 border-t border-stone-100 flex items-center justify-between">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    isVisible ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-600'
                  }`}>
                    {isVisible ? 'LIVE' : 'HIDDEN'}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(item)}
                      className="p-1 rounded hover:bg-stone-100 text-stone-600"
                      title="Edit Item"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteWork(item.id)}
                      className="p-1 rounded hover:bg-rose-50 text-rose-500"
                      title="Delete Work"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ADD / EDIT MODAL */}
      {(isAddingNew || editingWork) && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <h3 className="font-serif font-bold text-lg text-[#2D2424]">
                {isAddingNew ? 'Upload Artist Portfolio Work' : 'Edit Portfolio Details'}
              </h3>
              <button 
                type="button"
                onClick={() => {
                  setIsAddingNew(false);
                  setEditingWork(null);
                }}
                className="text-stone-400 hover:text-stone-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Work Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Royal Telugu Bridal HD Makeover"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Portfolio Category *</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                  >
                    {categories.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Media Type *</label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as any)}
                    className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                  >
                    <option value="image">Image / High-Res Photo</option>
                    <option value="video">Short Video / Reel</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Makeup Artist / Stylist *</label>
                <select
                  value={formArtistId}
                  onChange={(e) => {
                    setFormArtistId(e.target.value);
                    const matched = artists.find(a => a.id === e.target.value);
                    if (matched) setFormArtistName(matched.name);
                  }}
                  className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                >
                  <option value="">Select Artist Creator...</option>
                  {artists.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name} — {a.specialty}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Media URL *</label>
                <input
                  type="url"
                  required
                  placeholder="https://..."
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Description / Styling Notes</label>
                <textarea
                  rows={2}
                  placeholder="Products used, eye styling details, hair ornamentation..."
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                />
              </div>

              <div className="flex items-center gap-6 pt-1">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-stone-700">
                  <input
                    type="checkbox"
                    checked={formFeatured}
                    onChange={(e) => setFormFeatured(e.target.checked)}
                    className="rounded text-[#8C3A42] focus:ring-[#8C3A42]"
                  />
                  <span>Mark as Featured Item</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer font-medium text-stone-700">
                  <input
                    type="checkbox"
                    checked={formVisible}
                    onChange={(e) => setFormVisible(e.target.checked)}
                    className="rounded text-[#8C3A42] focus:ring-[#8C3A42]"
                  />
                  <span>Visible in Public Gallery</span>
                </label>
              </div>

              <div className="pt-3 border-t border-stone-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingNew(false);
                    setEditingWork(null);
                  }}
                  className="px-4 py-2 rounded-lg bg-stone-100 text-stone-700 hover:bg-stone-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#8C3A42] text-white hover:bg-[#722F36] font-medium"
                >
                  {isAddingNew ? 'Publish to Gallery' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
