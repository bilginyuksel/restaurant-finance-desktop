import { collection, onSnapshot, query, where, updateDoc, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { ReceiptPayload } from '../../shared/receipt';

export class PrintJobListener {
  private unsubscribe: (() => void) | null = null;
  private restaurantId: string;
  private deviceTag: string;

  constructor(restaurantId: string, deviceTag: string) {
    this.restaurantId = restaurantId;
    this.deviceTag = deviceTag;
  }

  public start() {
    this.stop();
    
    const q = query(
      collection(db, 'restaurants', this.restaurantId, 'print_jobs'),
      where('targetDesktopId', '==', this.deviceTag),
      where('status', '==', 'pending')
    );

    this.unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const job = change.doc.data();
          const jobId = change.doc.id;
          await this.processJob(jobId, job);
        }
      });
    }, (error) => {
      console.error('PrintJobListener error:', error);
    });
  }

  public stop() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private async processJob(jobId: string, jobData: any) {
    const jobRef = doc(db, 'restaurants', this.restaurantId, 'print_jobs', jobId);
    try {
      // The mobile app provides the payload for printing.
      const payload: ReceiptPayload = jobData.payload;
      
      if (!payload) {
        throw new Error('No print payload found in job');
      }

      // We use printCustomerBill for now, but could be printKitchenTicket based on kind
      let result;
      if (payload.kind === 'kitchen') {
         result = await window.api.printKitchenTicket(payload);
      } else {
         result = await window.api.printCustomerBill(payload);
      }
      
      if (result.ok) {
        await updateDoc(jobRef, { status: 'completed' });
      } else {
        await updateDoc(jobRef, { status: 'failed', error: result.error });
      }
    } catch (err: any) {
      console.error(`Failed to process print job ${jobId}:`, err);
      await updateDoc(jobRef, { status: 'failed', error: err.message });
    }
  }
}
