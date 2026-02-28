/**
 * ShipperLoadDetailsModal — delegates to the unified LoadDetailsModal
 * with userRole="shipper", giving shippers the full bid panel.
 */
import LoadDetailsModal from './LoadDetailsModal';

export default function ShipperLoadDetailsModal({ load, onClose, onAcceptLoad }) {
  return (
    <LoadDetailsModal
      load={load}
      userRole="shipper"
      onClose={onClose}
      onLoadAccepted={onAcceptLoad}
    />
  );
}
