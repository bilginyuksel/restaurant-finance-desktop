import { collection, getDocs, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { Table } from '../../shared/types';

export const fetchTableById = async (restaurantId: string, tableId: string): Promise<Table | null> => {
    const docRef = doc(db, 'restaurants', restaurantId, 'tables', tableId);
    const snapshot = await getDoc(docRef);
    if (snapshot.exists()) {
        return { id: snapshot.id, ...snapshot.data() } as Table;
    }
    return null;
};

export const fetchClosedTables = async (restaurantId: string, startDateIso: string, endDateIso: string): Promise<Table[]> => {
    const q = query(
        collection(db, 'restaurants', restaurantId, 'tables'),
        where('status', '==', 'closed'),
        where('closedAt', '>=', startDateIso),
        where('closedAt', '<=', endDateIso)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => doc.data() as Table);
};

export const listenToClosedTables = (
    restaurantId: string, 
    startDateIso: string, 
    endDateIso: string, 
    callback: (tables: Table[]) => void
) => {
    const q = query(
        collection(db, 'restaurants', restaurantId, 'tables'),
        where('status', '==', 'closed'),
        where('closedAt', '>=', startDateIso),
        where('closedAt', '<=', endDateIso)
    );
    return onSnapshot(q, (snapshot) => {
        callback(snapshot.docs.map(doc => doc.data() as Table));
    });
};
