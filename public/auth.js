const Auth = {
  getToken() { return sessionStorage.getItem('xx_token'); },
  setToken(t) { sessionStorage.setItem('xx_token', t); },
  getUser() { const u = sessionStorage.getItem('xx_user'); return u ? JSON.parse(u) : null; },
  setUser(u) { sessionStorage.setItem('xx_user', JSON.stringify(u)); },
  clear() { sessionStorage.removeItem('xx_token'); sessionStorage.removeItem('xx_user'); },
  headers(json = true) {
    const h = {};
    if (json) h['Content-Type'] = 'application/json';
    const t = this.getToken();
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  },
  isLoggedIn() { return !!this.getToken(); }
};
