import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './lib/session.jsx';
import { Loading } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Stock from './pages/Stock.jsx';
import Orders from './pages/Orders.jsx';
import Sales from './pages/Sales.jsx';
import Settlements from './pages/Settlements.jsx';
import Brands from './pages/Brands.jsx';
import UsersPage from './pages/Users.jsx';
import Account from './pages/Account.jsx';
import Goals from './pages/Goals.jsx';

export default function App() {
  const { loading, user, isOwner, isSeller } = useSession();
  if (loading) return <Loading />;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="ventas" element={<Sales />} />
        <Route path="stock" element={<Stock />} />
        <Route path="pedidos" element={<Orders kind="pedidos" />} />
        <Route path="pickups" element={<Orders kind="pickups" />} />
        {!isSeller && <Route path="liquidaciones" element={<Settlements />} />}
        <Route path="cuenta" element={<Account />} />
        {isOwner && <Route path="objetivos" element={<Goals />} />}
        {isOwner && <Route path="marcas" element={<Brands />} />}
        {isOwner && <Route path="usuarios" element={<UsersPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
