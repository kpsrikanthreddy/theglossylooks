import React from 'react';
import { Sparkles, Star, Award, Calendar, ExternalLink, Instagram } from 'lucide-react';
import { Artist } from '../types/salon';

interface ArtistsSectionProps {
  artists: Artist[];
  onBookWithArtist: (artist: Artist) => void;
  onFilterGalleryByArtist: (artistName: string) => void;
}

export const ArtistsSection: React.FC<ArtistsSectionProps> = ({
  artists,
  onBookWithArtist,
  onFilterGalleryByArtist,
}) => {
  return (
    <section id="artists" className="py-16 bg-[#FAF7F5]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto space-y-3 mb-12">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FAF0F1] border border-[#EAC9CB] text-[#8C3A42] text-xs font-semibold uppercase tracking-wider">
            <Award className="w-3.5 h-3.5" />
            <span>Master Cosmetologists & Stylists</span>
          </div>
          <h2 className="font-serif-luxury text-3xl sm:text-4xl lg:text-5xl font-bold text-[#2D2424]">
            Meet Our Acclaimed Artists
          </h2>
          <p className="text-sm sm:text-base text-[#6E5E5E] font-light">
            Each stylist and bridal artist brings international certifications, artistic precision, and 
            a warm personalized approach to every customer.
          </p>
        </div>

        {/* Artists Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {artists.map((artist) => (
            <div
              key={artist.id}
              className="bg-white rounded-2xl border border-[#E6DDD8] overflow-hidden flex flex-col justify-between shadow-xs hover:shadow-md transition-all group"
            >
              <div>
                {/* Profile Image & Avatar */}
                <div className="h-64 w-full relative overflow-hidden bg-[#ECE3E0]">
                  <img
                    src={artist.avatar}
                    alt={artist.name}
                    className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                  
                  {/* Rating Tag */}
                  <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-xs px-2.5 py-1 rounded-full flex items-center gap-1 text-xs font-bold text-[#2D2424] shadow-xs">
                    <Star className="w-3.5 h-3.5 fill-[#EAB308] text-[#EAB308]" />
                    <span>{artist.rating}</span>
                  </div>

                  {/* Experience Tag */}
                  <div className="absolute bottom-3 left-4 text-white">
                    <p className="text-xs uppercase tracking-wider font-medium text-[#E8C5C8]">
                      {artist.experienceYears}+ Years Experience
                    </p>
                    <h3 className="font-serif-luxury text-2xl font-bold">
                      {artist.name}
                    </h3>
                  </div>
                </div>

                {/* Details */}
                <div className="p-5 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-[#8C3A42] uppercase tracking-wide">
                      {artist.role}
                    </p>
                    <p className="text-xs text-[#7A6B6B] mt-0.5 font-medium">
                      Specialty: {artist.specialty}
                    </p>
                  </div>

                  <p className="text-xs text-[#524444] leading-relaxed">
                    {artist.bio}
                  </p>

                  {artist.instagram && (
                    <div className="pt-1 flex items-center gap-1.5 text-xs text-[#8C3A42] font-medium">
                      <Instagram className="w-3.5 h-3.5" />
                      <span>{artist.instagram}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="p-5 pt-0 border-t border-[#F2EAE7] flex items-center gap-2">
                <button
                  onClick={() => onBookWithArtist(artist)}
                  id={`book-with-artist-${artist.id}`}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-[#8C3A42] hover:bg-[#742F36] text-white py-2.5 px-3 rounded-xl text-xs font-semibold transition-colors"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Book with {artist.name.split(' ')[0]}</span>
                </button>

                <button
                  onClick={() => onFilterGalleryByArtist(artist.name)}
                  title="View this artist's portfolio"
                  className="flex items-center justify-center gap-1 bg-[#FAF7F5] hover:bg-[#F3ECE8] text-[#4A3C3C] border border-[#D9C4BE] py-2.5 px-3 rounded-xl text-xs font-medium transition-colors"
                >
                  <span>Works</span>
                  <ExternalLink className="w-3 h-3 text-[#8C3A42]" />
                </button>
              </div>

            </div>
          ))}
        </div>

      </div>
    </section>
  );
};
