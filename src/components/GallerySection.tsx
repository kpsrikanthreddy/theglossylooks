import React, { useState } from 'react';
import { 
  Sparkles, 
  Play, 
  Heart, 
  Tag, 
  User, 
  Calendar, 
  X, 
  UploadCloud, 
  Video as VideoIcon, 
  Image as ImageIcon,
  Share2
} from 'lucide-react';
import { GalleryWork, Artist } from '../types/salon';

interface GallerySectionProps {
  galleryItems: GalleryWork[];
  artists: Artist[];
  selectedArtistFilter?: string;
  onSelectArtistFilter: (artist: string) => void;
  onBookThisLook: (work: GalleryWork) => void;
  onOpenUploadInAdmin: () => void;
}

export const GallerySection: React.FC<GallerySectionProps> = ({
  galleryItems,
  artists,
  selectedArtistFilter = 'All',
  onSelectArtistFilter,
  onBookThisLook,
  onOpenUploadInAdmin,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [mediaTypeFilter, setMediaTypeFilter] = useState<'all' | 'image' | 'video'>('all');
  const [activeItem, setActiveItem] = useState<GalleryWork | null>(null);
  const [likedIds, setLikedIds] = useState<Record<string, boolean>>({});

  const categories = ['All', 'Bridal', 'Party Makeup', 'Hair Styling', 'Facial Glow', 'Nail Art', 'Reception'];

  const filteredItems = galleryItems.filter((item) => {
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    const matchesArtist = selectedArtistFilter === 'All' || item.artistName.toLowerCase() === selectedArtistFilter.toLowerCase();
    const matchesMediaType = mediaTypeFilter === 'all' || item.mediaType === mediaTypeFilter;
    return matchesCategory && matchesArtist && matchesMediaType;
  });

  const toggleLike = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setLikedIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  return (
    <section id="gallery" className="py-16 bg-white border-b border-[#EBE1DC]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FAF0F1] border border-[#EAC9CB] text-[#8C3A42] text-xs font-semibold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Real Transformations & Works</span>
            </div>
            <h2 className="font-serif-luxury text-3xl sm:text-4xl lg:text-5xl font-bold text-[#2D2424]">
              Artist Portfolio & Lookbook
            </h2>
            <p className="text-xs sm:text-sm text-[#6E5E5E] font-light">
              Explore authentic bridal transformations, hair balayage dimensions, and nail art couture created in-house. 
              Uploaded directly by our master artists.
            </p>
          </div>

          {/* Quick upload trigger for artists */}
          <button
            onClick={onOpenUploadInAdmin}
            id="artist-upload-cta-btn"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-[#FAF7F5] border border-[#D9C4BE] text-[#8C3A42] hover:bg-[#F5E6E7] hover:border-[#8C3A42] transition-colors self-start md:self-end"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Upload Work (Artist Panel)</span>
          </button>
        </div>

        {/* Filter Controls Bar */}
        <div className="bg-[#FAF7F5] p-4 rounded-2xl border border-[#E8DDD8] space-y-3 mb-8">
          
          {/* Top row: Artist and Media type filter */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            
            {/* Artist filter select */}
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-[#5A4B4B]">Filter By Artist:</span>
              <select
                value={selectedArtistFilter}
                onChange={(e) => onSelectArtistFilter(e.target.value)}
                className="bg-white border border-[#D9C4BE] text-xs text-[#2D2424] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#8C3A42]"
              >
                <option value="All">All Master Artists</option>
                {artists.map((art) => (
                  <option key={art.id} value={art.name}>
                    {art.name} ({art.role.split(' ')[0]})
                  </option>
                ))}
              </select>
            </div>

            {/* Media type toggle */}
            <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-[#D9C4BE] text-xs">
              <button
                onClick={() => setMediaTypeFilter('all')}
                className={`px-3 py-1 rounded-md transition-colors ${
                  mediaTypeFilter === 'all' ? 'bg-[#8C3A42] text-white font-semibold' : 'text-[#615252] hover:bg-[#FAF7F5]'
                }`}
              >
                All Works
              </button>
              <button
                onClick={() => setMediaTypeFilter('image')}
                className={`px-2.5 py-1 rounded-md flex items-center gap-1 transition-colors ${
                  mediaTypeFilter === 'image' ? 'bg-[#8C3A42] text-white font-semibold' : 'text-[#615252] hover:bg-[#FAF7F5]'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>Photos</span>
              </button>
              <button
                onClick={() => setMediaTypeFilter('video')}
                className={`px-2.5 py-1 rounded-md flex items-center gap-1 transition-colors ${
                  mediaTypeFilter === 'video' ? 'bg-[#8C3A42] text-white font-semibold' : 'text-[#615252] hover:bg-[#FAF7F5]'
                }`}
              >
                <VideoIcon className="w-3.5 h-3.5" />
                <span>Reels & Videos</span>
              </button>
            </div>

          </div>

          {/* Bottom row: Category Pills */}
          <div className="flex flex-wrap gap-1.5 pt-1 border-t border-[#E8DDD8]">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  selectedCategory === cat
                    ? 'bg-[#2D2424] text-white'
                    : 'bg-white text-[#574A4A] hover:bg-[#EFE7E4] border border-[#E0D3CF]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Gallery Grid */}
        {filteredItems.length === 0 ? (
          <div className="text-center py-16 bg-[#FAF7F5] rounded-2xl border border-dashed border-[#D9C8C4] max-w-md mx-auto p-6">
            <ImageIcon className="w-8 h-8 text-[#A89898] mx-auto mb-2" />
            <p className="text-sm font-semibold text-[#2D2424]">No works found in this filter</p>
            <p className="text-xs text-[#7A6B6B] mt-1">Try resetting the artist or category filters to view more.</p>
            <button
              onClick={() => {
                setSelectedCategory('All');
                onSelectArtistFilter('All');
                setMediaTypeFilter('all');
              }}
              className="mt-3 px-4 py-2 text-xs font-semibold text-[#8C3A42] bg-white border border-[#D9C4BE] rounded-lg"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filteredItems.map((item) => {
              const isLiked = likedIds[item.id];
              const likeCount = (item.likes ?? 0) + (isLiked ? 1 : 0);

              return (
                <div
                  key={item.id}
                  onClick={() => setActiveItem(item)}
                  className="group relative bg-[#FAF7F5] rounded-2xl overflow-hidden border border-[#E6DCD7] shadow-xs hover:shadow-md cursor-pointer transition-all duration-300 flex flex-col"
                >
                  {/* Thumbnail / Media Container */}
                  <div className="aspect-[4/5] w-full overflow-hidden relative bg-[#2D2424]">
                    {item.mediaType === 'video' ? (
                      <div className="w-full h-full relative">
                        <img
                          src={item.thumbnailUrl || 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=600&q=80'}
                          alt={item.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-90"
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-12 h-12 rounded-full bg-[#8C3A42]/90 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                            <Play className="w-5 h-5 ml-1 fill-white" />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <img
                        src={item.mediaUrl}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        loading="lazy"
                      />
                    )}

                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />

                    {/* Top tags */}
                    <div className="absolute top-3 left-3 flex items-center gap-1.5">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-white/90 text-[#2D2424] backdrop-blur-xs">
                        {item.category}
                      </span>
                      {item.mediaType === 'video' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#8C3A42] text-white flex items-center gap-1">
                          <VideoIcon className="w-3 h-3" />
                          <span>Video</span>
                        </span>
                      )}
                    </div>

                    {/* Like button on top right */}
                    <button
                      onClick={(e) => toggleLike(e, item.id)}
                      className={`absolute top-3 right-3 p-1.5 rounded-full backdrop-blur-xs transition-colors ${
                        isLiked ? 'bg-red-50 text-red-600' : 'bg-black/30 text-white hover:bg-black/50'
                      }`}
                    >
                      <Heart className={`w-3.5 h-3.5 ${isLiked ? 'fill-current' : ''}`} />
                    </button>

                    {/* Bottom overlay info */}
                    <div className="absolute bottom-3 left-3 right-3 text-white space-y-1">
                      <p className="text-[11px] text-[#E8C5C8] font-medium flex items-center gap-1">
                        <User className="w-3 h-3" />
                        <span>By {item.artistName}</span>
                      </p>
                      <h4 className="font-serif-luxury text-base font-bold leading-snug line-clamp-1">
                        {item.title}
                      </h4>
                      <div className="flex items-center justify-between text-[11px] text-[#D8C7C7] pt-1">
                        <span>{likeCount} likes</span>
                        <span className="text-[#E8C5C8] font-medium group-hover:underline">Click to View →</span>
                      </div>
                    </div>

                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>

      {/* Lightbox / Video Preview Modal */}
      {activeItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full overflow-hidden shadow-2xl border border-[#D9C4BE] max-h-[90vh] flex flex-col md:flex-row">
            
            {/* Media side */}
            <div className="md:w-3/5 bg-black flex items-center justify-center relative min-h-[300px]">
              {activeItem.mediaType === 'video' ? (
                <video
                  src={activeItem.mediaUrl}
                  controls
                  autoPlay
                  className="max-h-[500px] w-full object-contain"
                >
                  Your browser does not support the video tag.
                </video>
              ) : (
                <img
                  src={activeItem.mediaUrl}
                  alt={activeItem.title}
                  className="max-h-[500px] w-full object-contain"
                />
              )}

              <button
                onClick={() => setActiveItem(null)}
                className="md:hidden absolute top-3 right-3 bg-black/60 text-white p-2 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Info side */}
            <div className="md:w-2/5 p-6 flex flex-col justify-between overflow-y-auto">
              <div>
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#FAF0F1] text-[#8C3A42] border border-[#EAC9CB]">
                    {activeItem.category}
                  </span>
                  <button
                    onClick={() => setActiveItem(null)}
                    className="hidden md:block p-1.5 rounded-lg text-[#7A6B6B] hover:text-[#2D2424] hover:bg-[#F3ECE8]"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="mt-4 space-y-2">
                  <h3 className="font-serif-luxury text-2xl font-bold text-[#2D2424]">
                    {activeItem.title}
                  </h3>

                  <div className="flex items-center gap-2 text-xs text-[#6B5A5A] pb-2 border-b border-[#E8DDD8]">
                    <span className="font-semibold text-[#8C3A42]">Artist:</span>
                    <span>{activeItem.artistName}</span>
                    <span>•</span>
                    <span>{activeItem.createdAt}</span>
                  </div>

                  <p className="text-xs sm:text-sm text-[#4A3C3C] leading-relaxed pt-2">
                    {activeItem.description}
                  </p>

                  {/* Tags */}
                  <div className="pt-3 flex flex-wrap gap-1.5">
                    {(activeItem.tags || []).map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-[#FAF7F5] border border-[#E0D2CE] text-[#695757]"
                      >
                        <Tag className="w-2.5 h-2.5 text-[#8C3A42]" />
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Bottom CTAs */}
              <div className="mt-8 pt-4 border-t border-[#E8DDD8] space-y-2">
                <button
                  onClick={() => {
                    const itemToBook = activeItem;
                    setActiveItem(null);
                    onBookThisLook(itemToBook);
                  }}
                  className="w-full flex items-center justify-center gap-2 bg-[#8C3A42] hover:bg-[#742F36] text-white py-3 rounded-xl text-xs sm:text-sm font-semibold shadow-xs transition-colors"
                >
                  <Calendar className="w-4 h-4" />
                  <span>Book This Look with {activeItem.artistName.split(' ')[0]}</span>
                </button>
                <p className="text-[11px] text-center text-[#8A7979]">
                  Consultation included with every custom look booking.
                </p>
              </div>

            </div>

          </div>
        </div>
      )}
    </section>
  );
};
