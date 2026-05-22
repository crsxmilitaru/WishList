import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LinkifyPipe } from '@crsx/linkify';
import emailjs from '@emailjs/browser';
import { GoogleGenAI } from "@google/genai";
import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
import { ConfirmationService } from 'primeng/api';
import { Badge } from "primeng/badge";
import { PrimengModule } from 'src/primeng';
import { emailjsConfig } from './configs/emailjs-config';
import { firebaseConfig } from './configs/firebase-config';
import { googleConfigs } from './configs/google-configs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, PrimengModule, Badge, LinkifyPipe],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  db!: firebase.database.Database;
  userDialogVisible = false;
  groupDialogVisible = false;
  addDialogVisible = false;
  statusOptions = [
    { label: 'Disponibil', value: 'new' },
    { label: 'Mă ocup eu', value: 'pending' },
    { label: 'Am luat eu', value: 'done' }
  ];
  selectedTab: any = '0';
  emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  currentUser = {
    username: '',
    email: '',
    fullname: '',
    latestGroupCode: ''
  };
  currentGroupCode = '';
  newGroupCode = '';
  userGroups: any[] = [];
  groupMembers: any[] = [];
  wishes: any[] = [];
  newItemName = '';
  darkMode: string = 'disabled';
  faceIcons: string[] = ['Grinning.webp', 'GrinningEyesClosed.webp', 'Smiling.webp', 'SmilingEyesClosed.webp', 'Winking.webp'];
  isMobile: boolean = (typeof navigator !== 'undefined') && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  isSavingUser = false;
  isSavingItem = false;
  isLoadingItems = false;

  private readonly ai = new GoogleGenAI({
    apiKey: googleConfigs.apiKey
  });

  constructor(
    private confirmationService: ConfirmationService
  ) { }

  async ngOnInit(): Promise<void> {
    this.initializeFirebase();
    this.darkMode = localStorage.getItem('darkMode') || 'disabled';
    if (this.darkMode === 'enabled') {
      document.querySelector('html')!.classList.add('app-dark');
    }

    this.currentUser.username = localStorage.getItem('username')!;
    if (this.currentUser.username) {
      await this.loadAllData(true);
    } else {
      this.userDialogVisible = true;
    }
  }

  private initializeFirebase() {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    this.db = firebase.database();
  }

  getWishes(groupCode: string): Promise<void> {
    const itemsRef = this.db.ref('wishes').child(groupCode);
    return itemsRef.once('value').then((snapshot: any) => {
      const items = snapshot.val();
      if (items) {
        this.wishes = Object.keys(items).map(key => ({
          id: key,
          name: items[key].name,
          username: items[key].username,
          statusBy: items[key].statusBy,
          status: items[key].username == this.currentUser.username ? '-' : items[key].status,
          statusByFullname: this.groupMembers.find(u => u.username === items[key].statusBy)?.fullname,
          date: items[key].date,
          statusDate: items[key].statusDate,
          userFullname: this.groupMembers.find(u => u.username === items[key].username)?.fullname
        }));
      } else {
        this.wishes = [];
      }
    }).catch((error: any) => this.showError('Eroare la încărcarea dorințelor: ', error))
      .finally(() => {
        this.isLoadingItems = false;
      });
  }

  private getRandomItem<T>(list: T[]): T {
    const randomIndex = Math.floor(Math.random() * list.length);
    return list[randomIndex];
  }

  showAddDialog() {
    this.addDialogVisible = true;
    this.newItemName = '';
  }

  updateStatus(item: any, status: any) {
    if (status === 'done') {
      const oldStatus = item.status;
      item.status = null;
      this.confirmationService.confirm({
        header: `Ești sigur că ai luat dorința?`,
        message: 'Odată schimbat statusul nu va mai putea fi modificat.',
        acceptButtonStyleClass: 'p-button-success',
        rejectButtonStyleClass: 'p-button-secondary',
        acceptLabel: 'Da, am luat-o',
        rejectLabel: 'Nu, mă răzgândesc',
        accept: () => {
          this.finalizeStatusUpdate(item, status);
        },
        reject: () => {
          item.status = oldStatus;
          return;
        }
      });
    } else {
      this.finalizeStatusUpdate(item, status);
    }
  }

  private finalizeStatusUpdate(item: any, status: any) {
    item.status = status;
    item.statusBy = this.currentUser.username;
    item.statusDate = new Date().toISOString();
    const itemRef = this.db.ref('wishes').child(this.currentGroupCode).child(item.id);
    itemRef.update({
      status: item.status,
      statusBy: this.currentUser.username,
      statusDate: item.statusDate
    }).then(() => {
    }).catch((error: any) => this.showError('Eroare la schimbarea statusului dorinței: ', error));
  }

  getFilteredItems(tab: string) {
    switch (tab) {
      case '0':
        return this.wishes
          .filter((item: any) => item.username !== this.currentUser.username && item.status !== 'done')
          .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()).reverse();
      case '1':
        return this.wishes
          .filter((item: any) => item.username === this.currentUser.username)
          .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()).reverse();
      case '2':
        return this.wishes
          .filter((item: any) => item.username !== this.currentUser.username && item.status === 'done')
          .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()).reverse();
      default:
        return [];
    }
  }

  saveWish() {
    if (this.newItemName.trim()) {
      const newItem = {
        name: this.newItemName.trim(),
        username: this.currentUser.username,
        status: 'new',
        date: new Date().toISOString()
      };
      this.isSavingItem = true;
      const itemsRef = this.db.ref('wishes').child(this.currentGroupCode);
      const newItemRef = itemsRef.push(newItem);
      newItemRef.then(() => {
        const item = { ...newItem, id: newItemRef.key, userFullname: this.currentUser.fullname };
        this.wishes.push(item);
        this.sendMail(item);
        this.addDialogVisible = false;
      }).catch((error: any) => this.showError('Eroare la adăugarea dorinței: ', error))
        .finally(() => {
          this.isSavingItem = false;
        });
      newItem.status = '-';
      this.selectedTab = '1';
    }
  }

  deleteWish(wish: any) {
    this.confirmationService.confirm({
      header: 'Confirmare ștergere',
      message: `Ești sigur că vrei să ștergi dorința: <strong>${wish.name}</strong>?`,
      acceptLabel: 'Da, șterge',
      rejectLabel: 'Nu, anulază',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary',
      accept: () => {
        this.finalizeDeleteWish(wish);
      }
    });
  }

  private finalizeDeleteWish(wish: any) {
    const wishRef = this.db.ref('wishes').child(this.currentGroupCode).child(wish.id);
    wishRef.remove().then(() => {
      this.wishes = this.wishes.filter((i: any) => i.id !== wish.id);
    }).catch((error: any) => {
      this.showError('Eroare la ștergerea dorinței: ', error);
    });
  }

  saveUserData() {
    this.isSavingUser = true;
    this.currentGroupCode = this.currentGroupCode.trim().toLowerCase();
    this.currentUser = {
      email: this.currentUser.email.trim(),
      fullname: this.currentUser.fullname.trim(),
      username: this.currentUser.email.trim().split('@')[0].replace(/[^a-z0-9]/g, '').toLowerCase(),
      latestGroupCode: this.currentGroupCode
    }
    const ref = this.db.ref('users');
    ref.child(this.currentUser.username).set(this.currentUser).then(() => {
      localStorage.setItem('username', this.currentUser.username);
      this.addToGroupMembers(this.currentGroupCode, this.currentUser.username);
      this.loadAllData(false);
      this.userDialogVisible = false;
    }).catch((err: any) => this.showError('Eroare la salvarea utilizatorului: ', err))
      .finally(() => {
        this.isSavingUser = false;
      });
  }

  addToGroupMembers(groupCode: string, username: string) {
    const membersRef = this.db.ref('groups').child(groupCode).child('members');
    membersRef.once('value').then((snapshot: any) => {
      const members = snapshot.val() || {};
      if (!Object.values(members).includes(username)) {
        membersRef.push(username).catch((err: any) => this.showError('Eroare la adăugarea membrului în grup: ', err));
      }
    });
  }

  toggleDarkMode() {
    const element = document.querySelector('html')!;
    element.classList.toggle('app-dark');
    this.darkMode = element.classList.contains('app-dark') ? 'enabled' : 'disabled';
    localStorage.setItem('darkMode', this.darkMode);
  }

  async sendMail(item: any) {
    let emailMessage = await this.getAiMessage(item) || '';

    this.groupMembers.filter((u: any) => u.username !== this.currentUser.username).forEach((user: any) => {
      const templateParams = {
        name: item.userFullname,
        message: emailMessage,
        email: user.email
      };
      emailjs.send(emailjsConfig.serviceId, emailjsConfig.templateId, templateParams, emailjsConfig.userId)
        .catch((err: any) => this.showError('Eroare la trimiterea emailului: ', err));
    });
  }

  getGroups(username: string): Promise<void> {
    const groupsRef = this.db.ref('groups');
    return groupsRef.once('value').then((snapshot: any) => {
      const groups = snapshot.val();
      this.userGroups = [];
      if (groups) {
        Object.keys(groups).forEach((groupCode: string) => {
          const members = groups[groupCode].members;
          if (members) {
            const memberUsernames = Object.keys(members).map(k => members[k]);
            if (memberUsernames.includes(username)) {
              this.userGroups.push({ groupCode });
            }
          }
        });
      }
    });
  }

  getGroupMembers(groupCode: string): Promise<void> {
    this.groupMembers = [];
    const membersRef = this.db.ref('groups').child(groupCode).child('members');
    return membersRef.once('value').then(async (snapshot: any) => {
      const data = snapshot.val();
      if (data) {
        const usernames = Object.keys(data).map(k => data[k]);
        const profilePromises = usernames.map((u: string) => this.db.ref('users').child(u).once('value'));
        const snapshots = await Promise.all(profilePromises);
        snapshots.forEach((s: any, idx: number) => {
          const profile = s.val();
          if (profile) {
            this.groupMembers.push({
              email: profile.email,
              fullname: profile.fullname,
              username: profile.username || usernames[idx],
              faceIcon: this.getRandomItem(this.faceIcons)
            });
          }
        });
      }
    }).catch((error: any) => this.showError('Eroare la încărcarea utilizatorilor din grup: ', error));
  }

  async getAiMessage(item: any) {
    const response = await this.ai.models.generateContent({
      model: "gemini-flash-lite-latest",
      contents: `Găsește informații relevante despre: ${item.name}. Dacă este posibil, oferă o estimare de preț în lei și alternative similare sau recomandări. Nu repeta numele cadoului dacă nu este necesar.
      Dacă nu găsești nimic, răspunde cu: "Nu prea s-au găsit informații despre ${item.name}." Fără formatare cu bold și fără întrebări. Fără adresare personală. Maximum 35 de cuvinte.`
    });
    const text = `Lui ${item.userFullname} iar plăcea ${item.name}!\n${response.text}`;
    return text;
  }

  getUser(): Promise<void> {
    this.isLoadingItems = true;
    const userRef = this.db.ref('users').child(this.currentUser.username);
    return userRef.once('value').then((snapshot: any) => {
      if (snapshot.val()) {
        this.currentUser = { ...this.currentUser, ...snapshot.val() };
        this.currentGroupCode = this.currentUser.latestGroupCode || this.currentGroupCode;
      } else {
        this.isLoadingItems = false;
        this.userDialogVisible = true;
      }
    }).catch((error: any) => this.showError('Eroare la încărcarea utilizatorului: ', error));
  }

  private showError(message: string, error: any) {
    this.confirmationService.confirm({
      header: 'Eroare',
      message: `${message} <br> ${error?.message || error?.text || error?.error || error}`,
      acceptLabel: 'OK',
      acceptButtonStyleClass: 'p-button-secondary',
      rejectVisible: false
    });

    this.isLoadingItems = false;
    this.isSavingItem = false;
    this.isSavingUser = false;
  }

  async loadAllData(loadUser: boolean): Promise<void> {
    try {
      if (loadUser) {
        await this.getUser();
      }
      await this.getGroups(this.currentUser.username);
      await this.getGroupMembers(this.currentGroupCode);
      await this.getWishes(this.currentGroupCode);
    } catch (error) {
      this.showError('Eroare la încărcarea datelor: ', error);
    }
  }

  disconnectUser() {
    localStorage.removeItem('username');
    location.reload();
  }

  showChangeGroupDialog() {
    this.newGroupCode = '';
    this.groupDialogVisible = true;
  }

  changeGroup() {
    this.currentGroupCode = this.newGroupCode;

    const userRef = this.db.ref('users').child(this.currentUser.username);
    userRef.update({ latestGroupCode: this.currentGroupCode })
      .catch((err: any) => this.showError('Eroare la salvarea grupului utilizatorului: ', err));

    this.addToGroupMembers(this.currentGroupCode, this.currentUser.username);

    this.loadAllData(false);
    this.groupDialogVisible = false;
  }

  selectUserGroup(groupCode: string) {
    this.newGroupCode = groupCode;
    this.changeGroup();
  }

  isItemDeletable(item: any): boolean {
    return !!item.date && (Date.now() - new Date(item.date).getTime()) < 30 * 24 * 60 * 60 * 1000;
  }
}