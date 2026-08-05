import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './HeaderSearch.css';

// Lives in the top bar on every page. Typing a name or Customer ID and
// pressing Enter jumps to the Customers page with that search term already
// applied to its existing search box - this doesn't duplicate the filtering
// logic, it just drives the one Customers.js already has.
const HeaderSearch = () => {
  const [term, setTerm] = useState('');
  const navigate = useNavigate();

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = term.trim();
    if (!trimmed) return;
    navigate('/customers', { state: { search: trimmed } });
  };

  return (
    <form className="header-search" onSubmit={handleSubmit}>
      <span className="header-search-icon" aria-hidden="true">🔍</span>
      <input
        type="text"
        className="header-search-input"
        placeholder="Search customers by name or ID..."
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
    </form>
  );
};

export default HeaderSearch;
