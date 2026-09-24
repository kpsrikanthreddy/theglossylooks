import React, { useState, useEffect } from 'react';
import { 
  UserCheck, 
  Plus, 
  Search, 
  Edit3, 
  Phone, 
  Star, 
  CheckCircle2, 
  XCircle, 
  Calendar,
  X,
  Sparkles,
  Trash2,
  Lock,
  Mail,
  Shield,
  KeyRound,
  User,
  Users
} from 'lucide-react';
import { Artist, Appointment } from '../../types/salon';
import { AdminUser } from '../../types/admin';

interface AdminStaffProps {
  artists: Artist[];
  appointments: Appointment[];
  currentUser?: AdminUser;
  onAddArtist: (artist: Artist) => void;
  onUpdateArtist: (artist: Artist) => void;
  onDeleteArtist?: (id: string) => void;
}

export const AdminStaff: React.FC<AdminStaffProps> = ({
  artists,
  appointments,
  onAddArtist,
  onUpdateArtist,
  onDeleteArtist,
}) => {
  const [activeTab, setActiveTab] = useState<'logins' | 'stylists'>('logins');
  const [searchTerm, setSearchTerm] = useState('');

  // ----------------------------------------------------
  // Staff User Accounts (SALON_STAFF login accounts)
  // ----------------------------------------------------
  const [staffUsers, setStaffUsers] = useState<AdminUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [editingStaffUser, setEditingStaffUser] = useState<AdminUser | null>(null);

  // Form states for creating/editing staff account
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userPhone, setUserPhone] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userActive, setUserActive] = useState(true);
  const [userError, setUserError] = useState('');
  const [userSuccessMsg, setUserSuccessMsg] = useState('');

  // Fetch staff users from server
  const fetchStaffUsers = async () => {
    try {
      setLoadingUsers(true);
      const res = await fetch('/api/auth/staff', {
        headers: { 'Authorization': 'Bearer admin-secure-token-2026' }
      });
      if (res.ok) {
        const data = await res.json();
        setStaffUsers(data);
      }
    } catch (err) {
      console.warn('Error fetching staff logins:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    fetchStaffUsers();
  }, []);

  const handleCreateStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserError('');
    setUserSuccessMsg('');

    if (!userName.trim() || !userEmail.trim()) {
      setUserError('Name and Email are required.');
      return;
    }

    if (!editingStaffUser && (!userPassword || userPassword.length < 6)) {
      setUserError('Password must be at least 6 characters long.');
      return;
    }

    try {
      if (editingStaffUser) {
        // Update existing staff
        const res = await fetch(`/api/auth/staff/${editingStaffUser.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer admin-secure-token-2026',
          },
          body: JSON.stringify({
            name: userName.trim(),
            phone: userPhone.trim(),
            active: userActive,
            password: userPassword ? userPassword : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update staff account');
        setUserSuccessMsg('Staff member successfully updated!');
      } else {
        // Create new staff
        const res = await fetch('/api/auth/staff', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer admin-secure-token-2026',
          },
          body: JSON.stringify({
            name: userName.trim(),
            email: userEmail.trim().toLowerCase(),
            phone: userPhone.trim(),
            password: userPassword,
            role: 'SALON_STAFF',
            active: userActive,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create staff account');
        setUserSuccessMsg(`Staff login created for ${data.email}! They can now log in at /staff/login.`);
      }

      await fetchStaffUsers();
      setTimeout(() => {
        setIsAddUserModalOpen(false);
        setEditingStaffUser(null);
        setUserName('');
        setUserEmail('');
        setUserPhone('');
        setUserPassword('');
        setUserSuccessMsg('');
      }, 1500);
    } catch (err: any) {
      setUserError(err.message || 'Error saving staff account.');
    }
  };

  const handleToggleStaffActive = async (user: AdminUser) => {
    try {
      const res = await fetch(`/api/auth/staff/${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer admin-secure-token-2026',
        },
        body: JSON.stringify({ active: !user.active }),
      });
      if (res.ok) {
        await fetchStaffUsers();
      }
    } catch (err) {
      console.warn('Error toggling staff status:', err);
    }
  };

  const handleDeleteStaffUser = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to remove staff member "${name}"? They will no longer be able to log in.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/auth/staff/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer admin-secure-token-2026' },
      });
      if (res.ok) {
        setStaffUsers(prev => prev.filter(u => u.id !== id));
      }
    } catch (err) {
      console.warn('Error deleting staff account:', err);
    }
  };

  // ----------------------------------------------------
  // Stylist / Artist Public Profile Management
  // ----------------------------------------------------
  const [editingArtist, setEditingArtist] = useState<Artist | null>(null);
  const [isAddingArtist, setIsAddingArtist] = useState(false);

  // Form states for artist profile
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState('Senior Makeup Artist & Bridal Couturier');
  const [formSpecialty, setFormSpecialty] = useState('Bridal & HD Airbrush Makeup');
  const [formPhone, setFormPhone] = useState('+91 98765 43210');
  const [formExperience, setFormExperience] = useState<number>(5);
  const [formBio, setFormBio] = useState('');
  const [formAvatar, setFormAvatar] = useState('https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=400&q=80');
  const [formActive, setFormActive] = useState<boolean>(true);

  const handleOpenAddArtist = () => {
    setIsAddingArtist(true);
    setEditingArtist(null);
    setFormName('');
    setFormRole('Bridal & Editorial Makeup Specialist');
    setFormSpecialty('Bridal');
    setFormPhone('+91 98765 43210');
    setFormExperience(4);
    setFormBio('Certified artist specializing in bespoke bridal transformations and radiant skin prep.');
    setFormAvatar('https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80');
    setFormActive(true);
  };

  const handleOpenEditArtist = (art: Artist) => {
    setEditingArtist(art);
    setIsAddingArtist(false);
    setFormName(art.name);
    setFormRole(art.role);
    setFormSpecialty(art.specialty);
    setFormPhone(art.phone || '+91 98765 43210');
    setFormExperience(art.experienceYears);
    setFormBio(art.bio);
    setFormAvatar(art.avatar);
    setFormActive(art.active !== false);
  };

  const handleArtistFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (isAddingArtist) {
      const newArtist: Artist = {
        id: 'art-' + Date.now(),
        name: formName.trim(),
        role: formRole.trim(),
        specialty: formSpecialty.trim(),
        phone: formPhone.trim(),
        experienceYears: Number(formExperience),
        bio: formBio.trim(),
        avatar: formAvatar.trim(),
        rating: 4.9,
        active: formActive,
      };
      onAddArtist(newArtist);
      setIsAddingArtist(false);
    } else if (editingArtist) {
      const updated: Artist = {
        ...editingArtist,
        name: formName.trim(),
        role: formRole.trim(),
        specialty: formSpecialty.trim(),
        phone: formPhone.trim(),
        experienceYears: Number(formExperience),
        bio: formBio.trim(),
        avatar: formAvatar.trim(),
        active: formActive,
      };
      onUpdateArtist(updated);
      setEditingArtist(null);
    }
  };

  const handleDeleteArtist = (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to remove artist profile for "${name}"?`)) {
      if (onDeleteArtist) {
        onDeleteArtist(id);
      }
    }
  };

  const filteredStaffUsers = staffUsers.filter(u => 
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.phone && u.phone.includes(searchTerm))
  );

  const filteredArtists = artists.filter(a =>
    a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    a.specialty.toLowerCase().includes(searchTerm.toLowerCase()) ||
    a.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-serif font-bold text-2xl text-[#2D2424]">Staff & Team Management</h2>
          <p className="text-xs text-stone-500">
            Create and manage staff login accounts (SALON_STAFF) and public artist profiles.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'logins' ? (
            <button
              type="button"
              onClick={() => {
                setEditingStaffUser(null);
                setUserName('');
                setUserEmail('');
                setUserPhone('');
                setUserPassword('');
                setUserActive(true);
                setUserError('');
                setUserSuccessMsg('');
                setIsAddUserModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#8C3A42] hover:bg-[#742F36] text-white font-medium text-xs shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Staff Login</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleOpenAddArtist}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#8C3A42] hover:bg-[#742F36] text-white font-medium text-xs shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Artist Profile</span>
            </button>
          )}
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex border-b border-stone-200 gap-6 text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveTab('logins')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'logins'
              ? 'border-[#8C3A42] text-[#8C3A42]'
              : 'border-transparent text-stone-500 hover:text-stone-800'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>Staff Login Accounts (SALON_STAFF)</span>
          <span className="px-2 py-0.5 rounded-full bg-stone-100 text-[10px] text-stone-700">
            {staffUsers.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('stylists')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'stylists'
              ? 'border-[#8C3A42] text-[#8C3A42]'
              : 'border-transparent text-stone-500 hover:text-stone-800'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Stylists & Artists Profiles</span>
          <span className="px-2 py-0.5 rounded-full bg-stone-100 text-[10px] text-stone-700">
            {artists.length}
          </span>
        </button>
      </div>

      {/* Search Input */}
      <div className="relative max-w-sm">
        <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
        <input
          type="text"
          placeholder={activeTab === 'logins' ? "Search staff by name, email, phone..." : "Search stylists by name, specialty..."}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-stone-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/20"
        />
      </div>

      {/* TAB 1: STAFF LOGIN ACCOUNTS (SALON_STAFF) */}
      {activeTab === 'logins' && (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
                <tr>
                  <th className="py-3 px-4">Staff Name</th>
                  <th className="py-3 px-4">Login Email / Identifier</th>
                  <th className="py-3 px-4">Mobile</th>
                  <th className="py-3 px-4">Role Access</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredStaffUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-stone-400">
                      {loadingUsers ? 'Loading staff accounts...' : 'No staff accounts found. Click "Create Staff Login" above.'}
                    </td>
                  </tr>
                ) : (
                  filteredStaffUsers.map((user) => (
                    <tr key={user.id} className="hover:bg-stone-50/70 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-[#FAF0F1] text-[#8C3A42] flex items-center justify-center font-bold text-xs">
                            {user.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-semibold text-stone-800">{user.name}</p>
                            <p className="text-[10px] text-stone-400">ID: {user.id}</p>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4 font-mono text-stone-700">
                        {user.email}
                      </td>

                      <td className="py-3 px-4 text-stone-600">
                        {user.phone || '—'}
                      </td>

                      <td className="py-3 px-4">
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-[#FAF0F1] text-[#8C3A42] border border-[#E8C5C8]">
                          {user.role}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        {user.active !== false ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-medium text-[11px]">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Active</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-700 font-medium text-[11px]">
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Deactivated</span>
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right space-x-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingStaffUser(user);
                            setUserName(user.name);
                            setUserEmail(user.email);
                            setUserPhone(user.phone || '');
                            setUserPassword('');
                            setUserActive(user.active !== false);
                            setUserError('');
                            setUserSuccessMsg('');
                            setIsAddUserModalOpen(true);
                          }}
                          className="px-2 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 font-medium text-[11px] transition-colors cursor-pointer"
                        >
                          Edit / Reset Password
                        </button>

                        <button
                          type="button"
                          onClick={() => handleToggleStaffActive(user)}
                          className={`px-2 py-1 rounded-lg font-medium text-[11px] transition-colors cursor-pointer ${
                            user.active !== false 
                              ? 'bg-amber-50 hover:bg-amber-100 text-amber-800' 
                              : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {user.active !== false ? 'Deactivate' : 'Activate'}
                        </button>

                        {/* Remove Staff Option */}
                        <button
                          type="button"
                          onClick={() => handleDeleteStaffUser(user.id, user.name)}
                          className="px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-medium text-[11px] transition-colors cursor-pointer inline-flex items-center gap-1"
                          title="Remove Staff Member"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Remove Staff</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: STYLISTS & ARTISTS PUBLIC PROFILES */}
      {activeTab === 'stylists' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredArtists.map((artist) => (
            <div key={artist.id} className="bg-white rounded-2xl border border-stone-200 p-4 shadow-xs flex flex-col justify-between">
              <div className="flex items-start gap-3">
                <img
                  src={artist.avatar}
                  alt={artist.name}
                  className="w-16 h-16 rounded-xl object-cover bg-stone-100 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-sm text-[#2D2424] truncate">{artist.name}</h3>
                    <div className="flex items-center gap-0.5 text-amber-500 text-xs font-bold">
                      <Star className="w-3.5 h-3.5 fill-current" />
                      <span>{artist.rating}</span>
                    </div>
                  </div>
                  <p className="text-xs text-[#8C3A42] font-medium truncate">{artist.role}</p>
                  <p className="text-[11px] text-stone-500 mt-1 line-clamp-2">{artist.specialty}</p>
                </div>
              </div>

              <div className="pt-3 mt-3 border-t border-stone-100 flex items-center justify-between text-xs">
                <span className="text-stone-400 text-[11px]">{artist.experienceYears} Years Exp</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleOpenEditArtist(artist)}
                    className="p-1.5 rounded-lg text-stone-600 hover:text-[#8C3A42] hover:bg-stone-100 cursor-pointer"
                    title="Edit profile"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteArtist(artist.id, artist.name)}
                    className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 cursor-pointer"
                    title="Remove staff profile"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MODAL: CREATE / EDIT STAFF LOGIN */}
      {isAddUserModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div>
                <h3 className="font-serif font-bold text-lg text-[#2D2424]">
                  {editingStaffUser ? 'Edit Staff Account' : 'Create Staff Login'}
                </h3>
                <p className="text-xs text-stone-500">
                  Staff members log in via <code className="font-mono text-[#8C3A42]">/staff/login</code> with POS access
                </p>
              </div>
              <button 
                type="button"
                onClick={() => setIsAddUserModalOpen(false)}
                className="text-stone-400 hover:text-stone-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateStaffSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  Staff Full Name <span className="text-[#8C3A42]">*</span>
                </label>
                <div className="relative">
                  <User className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. Shalini Roy"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  Staff Login Email <span className="text-[#8C3A42]">*</span>
                </label>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    required
                    disabled={!!editingStaffUser}
                    placeholder="staff@theglossylooks.com"
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] disabled:bg-stone-100 disabled:text-stone-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  Staff Mobile Number
                </label>
                <div className="relative">
                  <Phone className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
                  <input
                    type="tel"
                    placeholder="+91 98765 43210"
                    value={userPhone}
                    onChange={(e) => setUserPhone(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  {editingStaffUser ? 'Set New Password (leave blank to keep current)' : 'Account Password *'}
                </label>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
                  <input
                    type="password"
                    required={!editingStaffUser}
                    placeholder="Minimum 6 characters"
                    value={userPassword}
                    onChange={(e) => setUserPassword(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  Assigned Role
                </label>
                <input
                  type="text"
                  disabled
                  value="SALON_STAFF (Restricted POS & Appointments access)"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-stone-100 text-stone-700 text-xs font-semibold"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="userActiveCheck"
                  checked={userActive}
                  onChange={(e) => setUserActive(e.target.checked)}
                  className="rounded text-[#8C3A42] focus:ring-[#8C3A42]"
                />
                <label htmlFor="userActiveCheck" className="text-stone-700 font-medium">
                  Account is active (can sign in to salon POS)
                </label>
              </div>

              {userError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs">
                  {userError}
                </div>
              )}

              {userSuccessMsg && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs">
                  {userSuccessMsg}
                </div>
              )}

              <div className="pt-3 border-t border-stone-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddUserModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-stone-100 text-stone-700 hover:bg-stone-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#8C3A42] hover:bg-[#742F36] text-white font-medium cursor-pointer"
                >
                  {editingStaffUser ? 'Save Changes' : 'Create Staff Login'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD / EDIT STYLIST PROFILE */}
      {(isAddingArtist || editingArtist) && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <h3 className="font-serif font-bold text-lg text-[#2D2424]">
                {isAddingArtist ? 'Add Artist Profile' : 'Edit Artist Profile'}
              </h3>
              <button 
                type="button"
                onClick={() => { setIsAddingArtist(false); setEditingArtist(null); }}
                className="text-stone-400 hover:text-stone-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleArtistFormSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Artist Name *</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 focus:ring-2 focus:ring-[#8C3A42]"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Role & Title *</label>
                <input
                  type="text"
                  required
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 focus:ring-2 focus:ring-[#8C3A42]"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Specialty & Skills *</label>
                <input
                  type="text"
                  required
                  value={formSpecialty}
                  onChange={(e) => setFormSpecialty(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 focus:ring-2 focus:ring-[#8C3A42]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Experience (Years)</label>
                  <input
                    type="number"
                    min={1}
                    value={formExperience}
                    onChange={(e) => setFormExperience(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-stone-300 focus:ring-2 focus:ring-[#8C3A42]"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-stone-300 focus:ring-2 focus:ring-[#8C3A42]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Avatar / Photo URL</label>
                <input
                  type="url"
                  value={formAvatar}
                  onChange={(e) => setFormAvatar(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 focus:ring-2 focus:ring-[#8C3A42]"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Bio / Profile Description</label>
                <textarea
                  rows={2}
                  value={formBio}
                  onChange={(e) => setFormBio(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 focus:ring-2 focus:ring-[#8C3A42]"
                />
              </div>

              <div className="pt-3 border-t border-stone-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setIsAddingArtist(false); setEditingArtist(null); }}
                  className="px-4 py-2 rounded-lg bg-stone-100 text-stone-700 hover:bg-stone-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#8C3A42] hover:bg-[#742F36] text-white font-medium cursor-pointer"
                >
                  Save Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
