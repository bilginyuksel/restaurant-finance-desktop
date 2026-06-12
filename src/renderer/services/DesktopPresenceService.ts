import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

export class DesktopPresenceService {
  private intervalId: NodeJS.Timeout | null = null;
  private restaurantId: string;
  private deviceTag: string;

  constructor(restaurantId: string, deviceTag: string) {
    this.restaurantId = restaurantId;
    this.deviceTag = deviceTag;
  }

  public async start() {
    this.stop();
    await this.ping(); // Initial ping
    this.intervalId = setInterval(() => this.ping(), 30000);
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async ping() {
    try {
      const docRef = doc(db, 'restaurants', this.restaurantId, 'active_desktops', this.deviceTag);
      await setDoc(
        docRef,
        {
          deviceId: this.deviceTag,
          displayName: `Desktop ${this.deviceTag}`,
          lastSeen: Date.now(),
        },
        { merge: true }
      );
    } catch (err) {
      console.error('Failed to update presence heartbeat:', err);
    }
  }
}
