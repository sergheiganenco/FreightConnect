import { useEffect, useState, useCallback } from "react";
import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TablePagination, IconButton, Tooltip, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, MenuItem, CircularProgress, Stack, InputAdornment,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import BlockIcon from "@mui/icons-material/Block";
import RestoreIcon from "@mui/icons-material/Restore";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import SearchIcon from "@mui/icons-material/Search";
import api from "../../services/api";
import { brand, surface, text as T, tint, status as ST } from '../../theme/tokens';

const ROLES = ["admin", "shipper", "carrier"];
const EMPTY_CREATE = { name: "", email: "", password: "", role: "carrier", companyName: "" };

export default function AdminUsers() {
  const [users, setUsers]           = useState([]);
  const [page, setPage]             = useState(0);
  const rowsPerPage                 = 10;
  const [total, setTotal]           = useState(0);
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  // Edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({});

  // Create modal
  const [createOpen, setCreateOpen]     = useState(false);
  const [createForm, setCreateForm]     = useState(EMPTY_CREATE);
  const [createErr, setCreateErr]       = useState("");
  const [createSaving, setCreateSaving] = useState(false);

  const fetchUsers = useCallback(async (pg = 0) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pg + 1,
        limit: rowsPerPage,
        ...(search     && { search }),
        ...(roleFilter && { role: roleFilter }),
      });
      const res = await api.get(`/admin/users?${params}`);
      setUsers(res.data.users || []);
      setTotal(res.data.total || 0);
    } catch {
      setUsers([]); setTotal(0);
    }
    setLoading(false);
  }, [search, roleFilter]);

  useEffect(() => { fetchUsers(page); }, [page, fetchUsers]);

  // Edit handlers
  const handleEdit = (user) => {
    setEditUser(user);
    setEditForm({
      name:        user.name        || "",
      email:       user.email       || "",
      companyName: user.companyName || "",
      role:        user.role        || "carrier",
      status:      user.status      || "active",
    });
    setEditOpen(true);
  };
  const handleEditChange = e => setEditForm(f => ({ ...f, [e.target.name]: e.target.value }));
  const handleEditSave = async () => {
    await api.patch(`/admin/users/${editUser._id}`, editForm);
    setEditOpen(false);
    fetchUsers(page);
  };

  const handleToggleStatus = async user => {
    await api.patch(`/admin/users/${user._id}/toggle-status`);
    fetchUsers(page);
  };

  // Create handlers
  const handleCreateChange = e => setCreateForm(f => ({ ...f, [e.target.name]: e.target.value }));
  const handleCreateSave = async () => {
    setCreateErr("");
    if (!createForm.name || !createForm.email || !createForm.password) {
      setCreateErr("Name, email and password are required.");
      return;
    }
    setCreateSaving(true);
    try {
      await api.post("/admin/users", createForm);
      setCreateOpen(false);
      setCreateForm(EMPTY_CREATE);
      fetchUsers(0);
    } catch (err) {
      setCreateErr(err?.response?.data?.error || "Failed to create user.");
    }
    setCreateSaving(false);
  };

  return (
    <Box sx={{ py: 5, px: { xs: 0, md: 3 }, width: "100%" }}>
      <Stack direction="row" alignItems="center" spacing={2} mb={3}>
        <Typography variant="h5" fontWeight={900} sx={{ color: T.primary, flex: 1 }}>
          User Management
        </Typography>
        <Button
          variant="contained"
          startIcon={<PersonAddIcon />}
          onClick={() => { setCreateForm(EMPTY_CREATE); setCreateErr(""); setCreateOpen(true); }}
          sx={{ bgcolor: brand.pink, fontWeight: 800, borderRadius: 99, "&:hover": { bgcolor: "#d12e8b" } }}
        >
          Create User
        </Button>
      </Stack>

      {/* Search + Role Filter */}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} mb={2}>
        <TextField
          placeholder="Search name or email…"
          size="small"
          value={search}
          onChange={e => setSearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: <InputAdornment position="start"><SearchIcon sx={{ color: ST.accepted }} /></InputAdornment>,
              sx: { bgcolor: surface.glass, color: T.primary, borderRadius: 2 },
            },
          }}
          sx={{ flex: 1, "& input": { color: T.primary } }}
        />
        <TextField
          select size="small" label="Role" value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
          sx={{ minWidth: 150, "& .MuiInputBase-root": { color: T.primary, bgcolor: surface.glass, borderRadius: 2 } }}
        >
          <MenuItem value="">All roles</MenuItem>
          {ROLES.map(r => <MenuItem key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</MenuItem>)}
        </TextField>
      </Stack>

      <Paper elevation={0} sx={{
        borderRadius: 4,
        background: surface.indigoTint,
        boxShadow: "0 4px 24px #1e034315",
        overflow: "hidden",
      }}>
        {loading ? (
          <Box p={8} display="flex" justifyContent="center"><CircularProgress /></Box>
        ) : (
          <>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ color: T.primary, fontWeight: 900 }}>Name</TableCell>
                    <TableCell sx={{ color: T.primary, fontWeight: 900 }}>Email</TableCell>
                    <TableCell sx={{ color: T.primary, fontWeight: 900 }}>Company</TableCell>
                    <TableCell sx={{ color: T.primary, fontWeight: 900 }}>Role</TableCell>
                    <TableCell sx={{ color: T.primary, fontWeight: 900 }}>Status</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {users.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ color: T.muted }}>
                        No users found.
                      </TableCell>
                    </TableRow>
                  ) : users.map(user => (
                    <TableRow key={user._id}>
                      <TableCell sx={{ color: T.primary }}>{user.name}</TableCell>
                      <TableCell sx={{ color: T.primary }}>{user.email}</TableCell>
                      <TableCell sx={{ color: T.primary }}>{user.companyName || "—"}</TableCell>
                      <TableCell>
                        <Chip
                          label={user.role} size="small"
                          sx={{
                            fontWeight: 700,
                            bgcolor: user.role === "admin" ? tint(brand.pink, 0.13) : user.role === "carrier" ? tint(brand.primary, 0.13) : tint('#1e88e5', 0.13),
                            color:   user.role === "admin" ? brand.pink              : user.role === "carrier" ? ST.accepted              : "#64b5f6",
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={user.status === "suspended" ? "Suspended" : "Active"}
                          color={user.status === "suspended" ? "error" : "success"}
                          size="small" sx={{ fontWeight: 700 }}
                        />
                      </TableCell>
                      <TableCell>
                        <Tooltip title="Edit User">
                          <IconButton onClick={() => handleEdit(user)} sx={{ color: brand.pink }}>
                            <EditIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={user.status === "suspended" ? "Reactivate" : "Suspend"}>
                          <IconButton onClick={() => handleToggleStatus(user)} sx={{ color: ST.accepted }}>
                            {user.status === "suspended" ? <RestoreIcon /> : <BlockIcon />}
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div" count={total} page={page}
              onPageChange={(_, newPage) => setPage(newPage)}
              rowsPerPage={rowsPerPage} rowsPerPageOptions={[10]}
              sx={{ ".MuiTablePagination-toolbar": { color: ST.accepted } }}
            />
          </>
        )}
      </Paper>

      {/* Edit User Dialog */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit User</DialogTitle>
        <DialogContent>
          <TextField fullWidth label="Name"    name="name"        sx={{ mb: 2, mt: 1 }} value={editForm.name        || ""} onChange={handleEditChange} />
          <TextField fullWidth label="Email"   name="email"       sx={{ mb: 2 }}        value={editForm.email       || ""} onChange={handleEditChange} />
          <TextField fullWidth label="Company" name="companyName" sx={{ mb: 2 }}        value={editForm.companyName || ""} onChange={handleEditChange} />
          <TextField fullWidth select label="Role" name="role" sx={{ mb: 2 }} value={editForm.role || "carrier"} onChange={handleEditChange}>
            {ROLES.map(r => <MenuItem key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</MenuItem>)}
          </TextField>
          <TextField fullWidth select label="Status" name="status" sx={{ mb: 2 }} value={editForm.status || "active"} onChange={handleEditChange}>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="suspended">Suspended</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button variant="contained" color="primary" onClick={handleEditSave}>Save</Button>
        </DialogActions>
      </Dialog>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Create New User</DialogTitle>
        <DialogContent>
          {createErr && (
            <Typography color="error" sx={{ mb: 1, mt: 0.5, fontSize: "0.9em" }}>{createErr}</Typography>
          )}
          <TextField fullWidth label="Full Name" name="name"     sx={{ mb: 2, mt: 1 }} value={createForm.name}     onChange={handleCreateChange} required />
          <TextField fullWidth label="Email"     name="email"    type="email" sx={{ mb: 2 }} value={createForm.email}    onChange={handleCreateChange} required />
          <TextField fullWidth label="Password"  name="password" type="password" sx={{ mb: 2 }} value={createForm.password} onChange={handleCreateChange} required helperText="Min 8 characters" />
          <TextField fullWidth select label="Role" name="role" sx={{ mb: 2 }} value={createForm.role} onChange={handleCreateChange}>
            {ROLES.map(r => <MenuItem key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</MenuItem>)}
          </TextField>
          {createForm.role !== "admin" && (
            <TextField fullWidth label="Company Name" name="companyName" sx={{ mb: 1 }} value={createForm.companyName} onChange={handleCreateChange} helperText="Required for carrier / shipper roles" />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={createSaving}>Cancel</Button>
          <Button
            variant="contained" onClick={handleCreateSave} disabled={createSaving}
            sx={{ bgcolor: brand.pink, "&:hover": { bgcolor: "#d12e8b" } }}
          >
            {createSaving ? "Creating…" : "Create User"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
