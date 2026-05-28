import React, { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Slider from "@react-native-community/slider";
import * as Location from "expo-location";
import { MapView, Marker } from "./src/MapComponents";
import { api, clearToken, getDefaultApiUrl } from "./src/api";

const DEFAULT_LOCATION = { lat: 56.2604, lng: 43.8467 };

const ORDER_STATUS_LABELS = {
  published: "Опубликован",
  responded: "Отклик",
  in_progress: "В работе",
  completed: "Завершён",
  cancelled: "Отменён",
};

function normalizeOrderStatus(status) {
  if (status === "assigned" || status === "pending_offer") return "in_progress";
  if (status === "draft" || status === "no_workers_available") return "published";
  if (status === "disputed") return "cancelled";
  return status || "published";
}

function haversineKm(from, to) {
  const lat1 = Number(from?.lat);
  const lng1 = Number(from?.lng);
  const lat2 = Number(to?.lat);
  const lng2 = Number(to?.lng);

  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;

  const radiusKm = 6371;
  const toRad = (value) => (value * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(lng2 - lng1);
  const a = Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radiusKm * c;
}

function Field({ value, onChangeText, placeholder, secureTextEntry, multiline, keyboardType }) {
  return (
    <TextInput
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType={keyboardType}
      multiline={multiline}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#7f91b2"
      secureTextEntry={secureTextEntry}
      style={[styles.input, multiline && styles.textarea]}
      textAlignVertical={multiline ? "top" : "center"}
      value={value}
    />
  );
}

function AppButton({ title, onPress, color = "#3278f6", disabled = false }) {
  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        Keyboard.dismiss();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: disabled ? "#b8c4d6" : color },
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Text numberOfLines={1} adjustsFontSizeToFit style={styles.buttonText}>
        {title}
      </Text>
    </Pressable>
  );
}

function SegmentedButton({ children, active, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.segment, active && styles.segmentActive]}>
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{children}</Text>
    </Pressable>
  );
}

function StatusBadge({ status }) {
  const normalizedStatus = normalizeOrderStatus(status);
  const label = ORDER_STATUS_LABELS[normalizedStatus] || "Опубликован";
  const style =
    normalizedStatus === "completed"
      ? styles.badgeGreen
      : normalizedStatus === "cancelled"
        ? styles.badgeRed
        : normalizedStatus === "in_progress"
          ? styles.badgeYellow
          : normalizedStatus === "responded"
            ? styles.badgeCyan
            : styles.badgePurple;

  return <Text style={[styles.statusBadge, style]}>{label}</Text>;
}

function RoutePreview({ currentLocation, order }) {
  return (
    <View style={styles.routePreview}>
      <View style={styles.routePointRow}>
        <View style={styles.routeDotBlue} />
        <View style={styles.routeTextBlock}>
          <Text style={styles.routeSmallLabel}>Вы</Text>
          <Text style={styles.routeText}>
            {currentLocation.lat.toFixed(4)}, {currentLocation.lng.toFixed(4)}
          </Text>
        </View>
      </View>
      <View style={styles.routeDash} />
      <View style={styles.routePointRow}>
        <View style={styles.routeDotPurple} />
        <View style={styles.routeTextBlock}>
          <Text style={styles.routeSmallLabel}>Заказ</Text>
          <Text style={styles.routeText}>{order.address}</Text>
        </View>
      </View>
    </View>
  );
}

export default function App() {
  const [step, setStep] = useState("auth");
  const [authMode, setAuthMode] = useState("login");
  const [mode, setMode] = useState("worker");
  const [tab, setTab] = useState("orders");
  const [email, setEmail] = useState("user@example.com");
  const [password, setPassword] = useState("password123");
  const [name, setName] = useState("Demo User");
  const [message, setMessage] = useState("Введите почту и пароль");
  const [isBusy, setIsBusy] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [location, setLocation] = useState(null);
  const [orders, setOrders] = useState([]);
  const [history, setHistory] = useState([]);
  const [responses, setResponses] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [employerOrders, setEmployerOrders] = useState([]);
  const [employerOrderResponses, setEmployerOrderResponses] = useState([]);
  const [responseCounts, setResponseCounts] = useState({});
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatText, setChatText] = useState("");
  const [approvedNoticeIds, setApprovedNoticeIds] = useState([]);
  const chatScrollRef = useRef(null);
  const distanceCacheRef = useRef({});
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [distanceFilter, setDistanceFilter] = useState(50);
  const [maxPriceFilter, setMaxPriceFilter] = useState(100000);
  const [workerRadius, setWorkerRadius] = useState(50);
  const [historyStatus, setHistoryStatus] = useState("");
  const [draft, setDraft] = useState({
    title: "Уборка квартиры 2-комн.",
    category: "Уборка квартир",
    description: "Требуется уборка квартиры: полы, пыль, кухня. Адрес указан точно, инвентарь есть на месте.",
    address: "Нижний Новгород, Большая Покровская улица, 1",
    price: "9000",
  });

  const currentLocation = location || DEFAULT_LOCATION;
  const backendUrl = getDefaultApiUrl();

  const categories = useMemo(() => {
    return Array.from(new Set(orders.map((order) => order.category).filter(Boolean)));
  }, [orders]);

  const visibleOrders = useMemo(() => {
    return orders
      .filter((order) => !categoryFilter || order.category === categoryFilter)
      .filter((order) => {
        const distance = getOrderDistanceKm(order);
        return distanceFilter >= 50 || !Number.isFinite(distance) || distance <= distanceFilter;
      })
      .filter((order) => Number(order.price || 0) <= maxPriceFilter)
      .slice(0, 30);
  }, [orders, categoryFilter, distanceFilter, maxPriceFilter, currentLocation]);

  const visibleHistory = useMemo(() => {
    return history.filter((order) => !historyStatus || normalizeOrderStatus(order.status) === historyStatus);
  }, [history, historyStatus]);

  const visibleEmployerOrders = useMemo(() => {
    const userId = currentUser?.id;
    return employerOrders.filter((order) => !userId || order.employer_id === userId);
  }, [employerOrders, currentUser]);

  function getOrderDistanceKm(order) {
    if (!order?.id) return null;

    const cachedDistance = distanceCacheRef.current[order.id];
    if (Number.isFinite(cachedDistance)) return cachedDistance;

    const backendDistance = Number(order?.distance_km);
    if (Number.isFinite(backendDistance) && backendDistance > 0) {
      distanceCacheRef.current[order.id] = backendDistance;
      return backendDistance;
    }

    const calculatedDistance = haversineKm(currentLocation, order);
    if (Number.isFinite(calculatedDistance) && calculatedDistance > 0) {
      distanceCacheRef.current[order.id] = calculatedDistance;
      return calculatedDistance;
    }

    return Number.isFinite(backendDistance) ? backendDistance : calculatedDistance;
  }

  function formatOrderDistance(order) {
    const distance = getOrderDistanceKm(order);
    if (!Number.isFinite(distance)) return "Не рассчитано";
    return `${distance.toFixed(1).replace(".", ",")} км`;
  }

  function getOrderResponseCount(order) {
    const backendCount = responseCounts[order.id] || 0;
    const localCount = responses.filter((response) => response.orderId === order.id).length;
    return Math.max(backendCount, localCount);
  }

  function mergeOrderKeepingDistance(current, updated) {
    if (!current || !updated || current.id !== updated.id) return updated || current;
    const cachedDistance = distanceCacheRef.current[current.id];
    return {
      ...current,
      ...updated,
      distance_km: updated.distance_km ?? current.distance_km ?? cachedDistance,
    };
  }

  function syncSelectedOrderFrom(items) {
    if (!Array.isArray(items)) return;
    setSelectedOrder((current) => {
      if (!current?.id) return current;
      const updated = items.find((item) => item.id === current.id);
      return updated ? mergeOrderKeepingDistance(current, updated) : current;
    });
  }

  useEffect(() => {
    if (step !== "app") return undefined;

    let cancelled = false;
    const syncOrders = async () => {
      try {
        if (mode === "worker") {
          const nearby = await api.nearbyOrders(currentLocation.lat, currentLocation.lng, 20000, {
            category: categoryFilter || undefined,
            maxPrice: maxPriceFilter,
          });
          if (!cancelled && Array.isArray(nearby)) {
            setOrders(nearby);
            syncSelectedOrderFrom(nearby);
          }
        }

        if (isAuthorized) {
          const mine = await api.myOrders();
          if (!cancelled && Array.isArray(mine)) {
            setHistory(mine);
            if (mode === "employer") {
              setEmployerOrders(mine);
              const pairs = await Promise.all(
                mine.map(async (order) => {
                  try {
                    const orderResponses = await api.orderResponses(order.id);
                    return [order.id, Array.isArray(orderResponses) ? orderResponses.length : 0];
                  } catch {
                    return [order.id, responseCounts[order.id] || 0];
                  }
                }),
              );
              if (!cancelled) {
                setResponseCounts(Object.fromEntries(pairs));
              }
            }
            syncSelectedOrderFrom(mine);
          }

          if (mode === "employer" && selectedOrder?.id) {
            const orderResponses = await api.orderResponses(selectedOrder.id);
            if (!cancelled && Array.isArray(orderResponses)) {
              setEmployerOrderResponses(orderResponses);
            }
          }
        }
      } catch {
        // Silent auto-sync: visible errors stay only for explicit user actions.
      }
    };

    syncOrders();
    const timer = setInterval(syncOrders, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    step,
    mode,
    isAuthorized,
    currentLocation.lat,
    currentLocation.lng,
    categoryFilter,
    maxPriceFilter,
    selectedOrder?.id,
  ]);

  useEffect(() => {
    if (step !== "app" || mode !== "worker" || !isAuthorized || !currentUser?.id) return undefined;

    let cancelled = false;
    const checkApproval = async () => {
      try {
        const data = await api.myOrders();
        if (cancelled || !Array.isArray(data)) return;
        setHistory(data);
        const approved = data.find(
          (order) =>
            order.assigned_worker_id === currentUser.id &&
            ["assigned", "in_progress"].includes(order.status) &&
            !approvedNoticeIds.includes(order.id),
        );
        if (approved) {
          setApprovedNoticeIds((items) => [...items, approved.id]);
          setMessage(`Работодатель одобрил ваш отклик: ${approved.title}. Откройте историю, чтобы перейти в чат.`);
        }
      } catch {
        // Silent polling: connection errors are already shown during explicit actions.
      }
    };

    checkApproval();
    const timer = setInterval(checkApproval, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [step, mode, isAuthorized, currentUser?.id, approvedNoticeIds]);

  useEffect(() => {
    const canUseChat =
      step === "app" &&
      isAuthorized &&
      selectedOrder?.id &&
      ["assigned", "in_progress"].includes(selectedOrder.status);

    if (!canUseChat) return undefined;

    let cancelled = false;
    const syncChat = async () => {
      try {
        const data = await api.messages(selectedOrder.id);
        if (!cancelled && Array.isArray(data)) {
          setChatMessages(data);
        }
      } catch {
        // Chat auto-refresh should not interrupt typing or block the order screen.
      }
    };

    syncChat();
    const timer = setInterval(syncChat, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [step, isAuthorized, selectedOrder?.id, selectedOrder?.status]);

  function explainError(error) {
    const text = error instanceof Error ? error.message : "Неизвестная ошибка";

    if (text.includes("Email already registered")) return "Аккаунт уже существует. Нажмите «Войти».";
    if (text.includes("Invalid credentials")) return "Неверная почта или пароль.";
    if (text.includes("Ошибка 401")) return "Нужно войти в аккаунт.";
    if (text.includes("Ошибка 409")) return "Действие конфликтует с текущим состоянием заказа.";
    if (text.includes("Ошибка 422")) return "Проверьте заполненные поля.";
    if (text.includes("Network request failed") || text.includes("Failed to fetch")) {
      return "Не удалось подключиться к backend. Проверьте сервер и Wi-Fi.";
    }

    return text;
  }

  async function run(action) {
    setIsBusy(true);
    try {
      await action();
    } catch (error) {
      setMessage(explainError(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function checkBackend() {
    setMessage("Проверяем backend...");
    const result = await api.health();
    setMessage(`Backend доступен: ${result.status}`);
  }

  async function submitAuth() {
    if (!email.trim() || !password.trim()) {
      setMessage("Введите почту и пароль");
      return;
    }

    if (password.length < 8) {
      setMessage("Пароль должен быть не короче 8 символов");
      return;
    }

    if (authMode === "register" && name.trim().length < 2) {
      setMessage("Введите никнейм или ФИО");
      return;
    }

    if (authMode === "register") {
      setMessage("Создаём аккаунт...");
      await api.register({
        email: email.trim(),
        password,
        full_name: name.trim(),
        active_mode: mode,
      });
      setMessage("Аккаунт создан. Выберите режим.");
    } else {
      setMessage("Входим...");
      await api.login({ email: email.trim(), password });
      setMessage("Вход выполнен. Выберите режим.");
    }

    setIsAuthorized(true);
    try {
      const profile = await api.profile();
      setCurrentUser(profile);
      if (profile?.full_name) setName(profile.full_name);
    } catch {
      setCurrentUser(null);
    }
    setStep("role");
  }

  async function continueWithoutAuth() {
    await clearToken();
    setIsAuthorized(false);
    setCurrentUser(null);
    setApprovedNoticeIds([]);
    setMessage("Демо-режим без авторизации");
    setStep("role");
  }

  function chooseMode(nextMode) {
    setMode(nextMode);
    setTab(nextMode === "worker" ? "orders" : "publish");
    setStep("location");
  }

  async function requestLocation() {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status === "granted") {
        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLocation({ lat: current.coords.latitude, lng: current.coords.longitude });
      }
    } catch {
      setLocation(DEFAULT_LOCATION);
    }

    setStep("app");

    if (mode === "worker") {
      await loadOrders();
    } else {
      await loadEmployerOrders();
    }
  }

  async function loadOrders() {
    const data = await api.nearbyOrders(currentLocation.lat, currentLocation.lng, 20000, {
      category: categoryFilter || undefined,
      maxPrice: maxPriceFilter,
    });
    setOrders(Array.isArray(data) ? data : []);
    setMessage(`Найдено заказов: ${Array.isArray(data) ? data.length : 0}`);
  }

  async function loadHistory() {
    if (!isAuthorized) {
      setMessage("История доступна после входа");
      return;
    }
    const data = await api.myOrders();
    const items = Array.isArray(data) ? data : [];
    setHistory(items);
    if (mode === "worker" && items.some((order) => order.assigned_worker_id === currentUser?.id && order.status === "assigned")) {
      setMessage("Работодатель одобрил ваш отклик. Откройте заказ в истории, чтобы перейти в чат.");
      return;
    }
    setMessage(`История обновлена: ${items.length}`);
  }

  async function loadEmployerOrders() {
    if (!isAuthorized) {
      setMessage("Заказы работодателя доступны после входа");
      return;
    }
    const data = await api.myOrders();
    const items = Array.isArray(data) ? data : [];
    setEmployerOrders(items);
    setHistory(items);
    setMessage(`Ваши заказы обновлены: ${items.length}`);
  }

  async function publishOrder() {
    if (!isAuthorized) {
      setMessage("Для публикации заказа нужно войти или создать аккаунт");
      return;
    }

    const created = await api.createOrder({
      title: draft.title,
      category: draft.category,
      description: draft.description,
      address: draft.address,
      price: Number(draft.price),
    });
    setEmployerOrders((items) => [created, ...items]);
    setHistory((items) => [created, ...items]);
    setMessage("Заказ опубликован");
  }

  async function respondToOrder(order) {
    if (!isAuthorized) {
      setMessage("Для отклика нужно войти или создать аккаунт");
      return;
    }

    await api.respond(order.id, "Готов выполнить заказ");
    const response = {
      id: `${order.id}-${Date.now()}`,
      orderId: order.id,
      orderTitle: order.title,
      workerName: name || email,
      workerEmail: email,
      workerRating: "4.9",
      createdAt: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
    };
    setResponses((items) => [response, ...items]);
    setOrders((items) => items.map((item) => (item.id === order.id ? { ...item, status: "responded" } : item)));
    setHistory((items) => items.map((item) => (item.id === order.id ? { ...item, status: "responded" } : item)));
    setSelectedOrder((current) => (current?.id === order.id ? { ...current, status: "responded" } : current));
    setMessage("Отклик отправлен работодателю");
  }

  async function completeOrder(order) {
    await api.completeOrder(order.id);
    setOrders((items) => items.map((item) => (item.id === order.id ? { ...item, status: "completed" } : item)));
    setEmployerOrders((items) => items.map((item) => (item.id === order.id ? { ...item, status: "completed" } : item)));
    setHistory((items) => items.map((item) => (item.id === order.id ? { ...item, status: "completed" } : item)));
    setSelectedOrder((current) => (current?.id === order.id ? { ...current, status: "completed" } : current));
    setMessage("Заказ завершён");
  }

  async function cancelOrder(order) {
    await api.cancelOrder(order.id);
    setOrders((items) => items.map((item) => (item.id === order.id ? { ...item, status: "cancelled" } : item)));
    setEmployerOrders((items) => items.map((item) => (item.id === order.id ? { ...item, status: "cancelled" } : item)));
    setHistory((items) => items.map((item) => (item.id === order.id ? { ...item, status: "cancelled" } : item)));
    setSelectedOrder((current) => (current?.id === order.id ? { ...current, status: "cancelled" } : current));
    setMessage("Заказ отменён");
  }

  async function loadSelectedOrderResponses(order) {
    if (!isAuthorized) return;
    const data = await api.orderResponses(order.id);
    const items = Array.isArray(data) ? data : [];
    setEmployerOrderResponses(items);
    setResponseCounts((counts) => ({ ...counts, [order.id]: items.length }));
  }

  async function loadChatMessages(order) {
    if (!isAuthorized) return;
    if (!["assigned", "in_progress"].includes(order.status)) {
      setChatMessages([]);
      return;
    }
    const data = await api.messages(order.id);
    setChatMessages(Array.isArray(data) ? data : []);
  }

  async function sendChatMessage(order) {
    const text = chatText.trim();
    if (!text) return;
    let activeOrder = order;
    if (mode === "employer" && order.status === "assigned") {
      activeOrder = await api.startOrder(order.id);
      setEmployerOrders((items) => items.map((item) => (item.id === activeOrder.id ? activeOrder : item)));
      setHistory((items) => items.map((item) => (item.id === activeOrder.id ? activeOrder : item)));
      setSelectedOrder((current) => mergeOrderKeepingDistance(current || order, activeOrder));
    }
    const sent = await api.sendMessage(activeOrder.id, text);
    setChatMessages((items) => [...items, sent]);
    setChatText("");
  }

  async function acceptResponse(response) {
    const updated = await api.assignWorker(response.order_id, response.id);
    setEmployerOrders((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    setHistory((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    setSelectedOrder((current) => mergeOrderKeepingDistance(current, updated));
    await loadChatMessages(updated);
    setMessage("Исполнитель выбран. Работнику придёт уведомление в истории, чат уже доступен.");
  }

  async function startSelectedOrder(order) {
    const updated = await api.startOrder(order.id);
    setEmployerOrders((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    setHistory((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    setSelectedOrder((current) => mergeOrderKeepingDistance(current, updated));
    await loadChatMessages(updated);
    setMessage("Заказ переведён в работу");
  }

  async function openEmployerOrder(order) {
    getOrderDistanceKm(order);
    setSelectedOrder(order);
    setEmployerOrderResponses([]);
    if (isAuthorized) {
      await loadSelectedOrderResponses(order);
      await loadChatMessages(order);
    }
  }

  async function openWorkerOrder(order) {
    getOrderDistanceKm(order);
    setSelectedOrder(order);
    setDescriptionOpen(false);
    await loadChatMessages(order);
  }

  function AuthScreen() {
    return (
      <View style={styles.authCard}>
        <Text style={styles.company}>РАБОТА РЯДОМ</Text>
        <Text style={styles.welcome}>Добро пожаловать!</Text>

        <View style={styles.authSwitch}>
          <SegmentedButton active={authMode === "login"} onPress={() => setAuthMode("login")}>
            Вход
          </SegmentedButton>
          <SegmentedButton active={authMode === "register"} onPress={() => setAuthMode("register")}>
            Регистрация
          </SegmentedButton>
        </View>

        <Field value={email} onChangeText={setEmail} placeholder="ПОЧТА" keyboardType="email-address" />
        <Field value={password} onChangeText={setPassword} placeholder="ПАРОЛЬ" secureTextEntry />
        {authMode === "register" && <Field value={name} onChangeText={setName} placeholder="НИКНЕЙМ ИЛИ ФИО" />}

        <AppButton title="ПРОВЕРИТЬ BACKEND" color="#0f2f57" disabled={isBusy} onPress={() => run(checkBackend)} />
        <AppButton
          title={authMode === "register" ? "СОЗДАТЬ АККАУНТ" : "ВОЙТИ"}
          color="#3278f6"
          disabled={isBusy}
          onPress={() => run(submitAuth)}
        />
        <AppButton title="ПРОДОЛЖИТЬ БЕЗ ВХОДА" color="#6f82a4" disabled={isBusy} onPress={() => run(continueWithoutAuth)} />

        <Text style={styles.apiHint}>Backend: {backendUrl}</Text>
        <Text style={styles.status}>{message}</Text>
      </View>
    );
  }

  function RoleScreen() {
    return (
      <View style={styles.authCard}>
        <Text style={styles.company}>ВЫБОР РЕЖИМА</Text>
        <Text style={styles.welcome}>Как хотите продолжить?</Text>

        <View style={styles.roleCardPurple}>
          <Text style={styles.roleTitlePurple}>Работник</Text>
          <Text style={styles.roleText}>Смотреть задания рядом, быть на линии и откликаться.</Text>
          <AppButton title="ПРОДОЛЖИТЬ КАК РАБОТНИК" color="#8b5cf6" onPress={() => chooseMode("worker")} />
        </View>

        <View style={styles.roleCardBlue}>
          <Text style={styles.roleTitleBlue}>Работодатель</Text>
          <Text style={styles.roleText}>Публиковать задания, смотреть историю и выбирать исполнителей.</Text>
          <AppButton title="ПРОДОЛЖИТЬ КАК РАБОТОДАТЕЛЬ" color="#0f2f57" onPress={() => chooseMode("employer")} />
        </View>

        <AppButton title="НАЗАД К АВТОРИЗАЦИИ" color="#a9c0f3" onPress={() => setStep("auth")} />
        <Text style={styles.status}>{isAuthorized ? `Вы вошли как ${email}` : "Вы в демо-режиме"}</Text>
      </View>
    );
  }

  function LocationScreen() {
    return (
      <View style={styles.authCard}>
        <Text style={styles.company}>ГЕОЛОКАЦИЯ</Text>
        <Text style={styles.welcome}>Найдём заказы рядом</Text>
        <Text style={styles.status}>Разрешите доступ к геолокации, чтобы рассчитать расстояние до заказов.</Text>
        <AppButton title="РАЗРЕШИТЬ" color={mode === "worker" ? "#8b5cf6" : "#0f2f57"} onPress={() => run(requestLocation)} />
        <AppButton
          title="ПРОПУСТИТЬ"
          color="#a9c0f3"
          onPress={() => {
            setStep("app");
            setTab(mode === "worker" ? "orders" : "publish");
          }}
        />
      </View>
    );
  }

  function OrdersScreen() {
    return (
      <View style={styles.phone}>
        <View style={styles.topBar}>
          <View>
            <Text style={styles.topTitle}>Заказы</Text>
            <Text style={styles.topMeta}>Радиус {workerRadius} км</Text>
          </View>
        </View>

        <View style={styles.mapWrap}>
          <MapView
            style={styles.map}
            initialRegion={{
              latitude: currentLocation.lat,
              longitude: currentLocation.lng,
              latitudeDelta: 0.45,
              longitudeDelta: 0.45,
            }}
          >
            <Marker coordinate={{ latitude: currentLocation.lat, longitude: currentLocation.lng }} title="Вы здесь" pinColor="#3278f6" />
            {visibleOrders.slice(0, 12).map((order) => (
              <Marker
                key={order.id}
                coordinate={{ latitude: Number(order.lat), longitude: Number(order.lng) }}
                title={order.title}
                description={`${order.price} ₽`}
                pinColor="#8b5cf6"
              />
            ))}
          </MapView>
        </View>

        <View style={styles.sheetHeader}>
          <Text style={styles.sectionTitle}>Доступные заказы</Text>
          <Pressable style={styles.filterButton} onPress={() => setFiltersOpen(!filtersOpen)}>
            <Text style={styles.filterButtonText}>≡</Text>
          </Pressable>
        </View>

        {filtersOpen && (
          <View style={styles.filters}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
              <SegmentedButton active={!categoryFilter} onPress={() => setCategoryFilter("")}>
                Все
              </SegmentedButton>
              {categories.map((category) => (
                <SegmentedButton key={category} active={categoryFilter === category} onPress={() => setCategoryFilter(category)}>
                  {category}
                </SegmentedButton>
              ))}
            </ScrollView>

            <Text style={styles.sliderLabel}>Дальность до {Math.round(distanceFilter)} км</Text>
            <Slider minimumValue={1} maximumValue={50} step={1} value={distanceFilter} onValueChange={setDistanceFilter} />

            <Text style={styles.sliderLabel}>Цена до {Math.round(maxPriceFilter)} ₽</Text>
            <Slider minimumValue={500} maximumValue={100000} step={500} value={maxPriceFilter} onValueChange={setMaxPriceFilter} />

          </View>
        )}

        <ScrollView style={styles.ordersList} contentContainerStyle={styles.ordersListContent}>
          {visibleOrders.map((order) => (
            <Pressable key={order.id} style={styles.orderRow} onPress={() => run(() => openWorkerOrder(order))}>
              <View style={styles.orderStripe} />
              <View style={styles.orderBody}>
                <View style={styles.orderTitleRow}>
                  <Text style={styles.orderTitle}>{order.title}</Text>
                  <StatusBadge status={order.status} />
                </View>
                <Text style={styles.orderMeta}>{order.address}</Text>
                <Text style={styles.orderDistance}>{formatOrderDistance(order)}</Text>
              </View>
              <Text style={styles.orderPrice}>{order.price} ₽</Text>
            </Pressable>
          ))}
          {visibleOrders.length === 0 && <Text style={styles.status}>Заказы появятся здесь автоматически.</Text>}
        </ScrollView>
      </View>
    );
  }

  function ChatBox(order, title) {
    return (
      <View style={styles.chatPanel}>
        <Text style={styles.detailLabel}>{title}</Text>

        <ScrollView
          ref={chatScrollRef}
          nestedScrollEnabled
          showsVerticalScrollIndicator
          style={styles.chatList}
          contentContainerStyle={styles.chatListContent}
          onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: true })}
        >
          {chatMessages.map((item) => {
            const mine = item.author_id === currentUser?.id;
            return (
              <View key={item.id} style={mine ? styles.chatBubbleEmployer : styles.chatBubbleWorker}>
                <Text style={styles.chatText}>{item.text}</Text>
              </View>
            );
          })}
          {chatMessages.length === 0 && <Text style={styles.detailText}>Сообщений пока нет. Напишите первым.</Text>}
        </ScrollView>

        <View style={styles.chatInputRow}>
          <View style={styles.chatInputWrap}>
            <Field value={chatText} onChangeText={setChatText} placeholder="Сообщение" />
          </View>
          <Pressable style={styles.chatSendButton} onPress={() => run(() => sendChatMessage(order))}>
            <Text style={styles.chatSendText}>➤</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function DetailsScreen() {
    if (!selectedOrder) return null;

    const isBookmarked = bookmarks.includes(selectedOrder.id);
    const workerCanChat = ["assigned", "in_progress"].includes(selectedOrder.status);
    const yandexUrl = `https://yandex.ru/maps/?rtext=${currentLocation.lat},${currentLocation.lng}~${Number(selectedOrder.lat)},${Number(
      selectedOrder.lng,
    )}&rtt=mt`;

    return (
      <View style={styles.phone}>
        {descriptionOpen && (
          <View style={styles.overlay}>
            <View style={styles.modal}>
              <Text style={styles.modalTitle}>Описание заказа</Text>
              <Text style={styles.detailText}>{selectedOrder.description || "Описание не указано"}</Text>
              <AppButton title="ЗАКРЫТЬ" color="#0f2f57" onPress={() => setDescriptionOpen(false)} />
            </View>
          </View>
        )}

        <View style={styles.detailHeader}>
          <Pressable onPress={() => setSelectedOrder(null)}>
            <Text style={styles.backArrow}>‹</Text>
          </Pressable>
          <View style={styles.detailTitleBlock}>
            <Text style={styles.detailTitle}>{selectedOrder.title}</Text>
            <Text style={styles.detailPrice}>{selectedOrder.price} ₽</Text>
          </View>
          <StatusBadge status={selectedOrder.status} />
        </View>

        <Text style={styles.badge}>{selectedOrder.category}</Text>
        <View style={styles.compactRow}>
          <Text numberOfLines={1} style={styles.detailTextCompact}>
            {selectedOrder.description || "Описание не указано"}
          </Text>
          <Pressable style={styles.moreButton} onPress={() => setDescriptionOpen(true)}>
            <Text style={styles.moreButtonText}>…</Text>
          </Pressable>
        </View>

        <View style={styles.twoColInfo}>
          <View style={styles.infoCell}>
            <Text style={styles.detailLabel}>Адрес</Text>
            <Text style={styles.detailText}>{selectedOrder.address}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.detailLabel}>Расстояние</Text>
            <Text style={styles.detailText}>{formatOrderDistance(selectedOrder)}</Text>
          </View>
        </View>

        <View>
          <Text style={styles.detailLabel}>Маршрут</Text>
          <Pressable onPress={() => Linking.openURL(yandexUrl)}>
            <Text style={styles.routeLink}>Оценить в Яндекс Картах╰➤</Text>
          </Pressable>
        </View>

        <View style={styles.respondRow}>
          <View style={styles.respondMain}>
            <AppButton
              title={workerCanChat ? "ОТКЛИК ОДОБРЕН" : "ОТКЛИКНУТЬСЯ"}
              color="#8b5cf6"
              disabled={workerCanChat}
              onPress={() => run(() => respondToOrder(selectedOrder))}
            />
          </View>
          <Pressable
            style={[styles.bookmarkButton, isBookmarked && styles.bookmarkButtonActive]}
            onPress={() =>
              setBookmarks((items) =>
                items.includes(selectedOrder.id) ? items.filter((id) => id !== selectedOrder.id) : [...items, selectedOrder.id],
              )
            }
          >
            <Text style={styles.bookmarkText}>{isBookmarked ? "★" : "☆"}</Text>
          </Pressable>
        </View>

        {workerCanChat && ChatBox(selectedOrder, "Чат с работодателем")}

      </View>
    );
  }

  function PublishScreen() {
    return (
      <View style={styles.phone}>
        <Text style={styles.topTitle}>Новый заказ</Text>
        <Field value={draft.category} onChangeText={(value) => setDraft({ ...draft, category: value })} placeholder="Категория" />
        <Field value={draft.title} onChangeText={(value) => setDraft({ ...draft, title: value })} placeholder="Заголовок" />
        <Field
          value={draft.description}
          onChangeText={(value) => setDraft({ ...draft, description: value })}
          placeholder="Описание"
          multiline
        />
        <Field value={draft.address} onChangeText={(value) => setDraft({ ...draft, address: value })} placeholder="Адрес с номером дома" />
        <Field value={draft.price} onChangeText={(value) => setDraft({ ...draft, price: value })} placeholder="Оплата" keyboardType="numeric" />
        <AppButton title="ОПУБЛИКОВАТЬ ЗАКАЗ" color="#0f2f57" onPress={() => run(publishOrder)} />
        <Text style={styles.status}>{message}</Text>
      </View>
    );
  }

  function EmployerOrdersScreen() {
    return (
      <View style={styles.phone}>
        <View style={styles.topBar}>
          <Text style={styles.topTitle}>Заказы</Text>
        </View>

        <ScrollView style={styles.ordersList} contentContainerStyle={styles.ordersListContent}>
          {visibleEmployerOrders.map((order) => {
            const responseCount = getOrderResponseCount(order);
            return (
              <Pressable key={order.id} style={styles.orderRow} onPress={() => run(() => openEmployerOrder(order))}>
                <View style={styles.orderStripe} />
                <View style={styles.orderBody}>
                  <View style={styles.orderTitleRow}>
                    <Text style={styles.orderTitle}>{order.title}</Text>
                    <StatusBadge status={order.status} />
                  </View>
                  <Text style={styles.orderMeta}>{order.address}</Text>
                  <Text style={styles.orderDistance}>Отклики: {responseCount}</Text>
                </View>
                <Text style={styles.orderPrice}>{order.price} ₽</Text>
              </Pressable>
            );
          })}
          {visibleEmployerOrders.length === 0 && <Text style={styles.status}>Созданные заказы появятся здесь.</Text>}
        </ScrollView>
      </View>
    );
  }

  function EmployerOrderScreen() {
    if (!selectedOrder) return null;
    const status = normalizeOrderStatus(selectedOrder.status);

    return (
      <View style={styles.phone}>
        <View style={styles.detailHeader}>
          <Pressable onPress={() => setSelectedOrder(null)}>
            <Text style={styles.backArrow}>‹</Text>
          </Pressable>
          <View style={styles.detailTitleBlock}>
            <Text style={styles.detailTitle}>{selectedOrder.title}</Text>
            <Text style={styles.detailPrice}>{selectedOrder.price} ₽</Text>
          </View>
          <StatusBadge status={selectedOrder.status} />
        </View>

        {["assigned", "in_progress"].includes(selectedOrder.status) ? (
          ChatBox(selectedOrder, "Чат с исполнителем")
        ) : (
          <View style={styles.chatPanel}>
            <Text style={styles.detailLabel}>Чат с исполнителем</Text>
            <Text style={styles.detailText}>Чат откроется после выбора исполнителя.</Text>
          </View>
        )}

        <View style={styles.profilePanel}>
          <View style={styles.topBar}>
            <Text style={styles.detailLabel}>Отклики</Text>
          </View>
          {employerOrderResponses.length === 0 && responses.filter((item) => item.orderId === selectedOrder.id).length === 0 && (
            <Text style={styles.detailText}>Пока нет откликов на этот заказ.</Text>
          )}
          {employerOrderResponses.map((response) => (
            <View key={response.id} style={styles.responseMini}>
              <View style={styles.responseMiniBody}>
                <Text style={styles.responseTitle}>Исполнитель #{response.worker_id.slice(0, 6)}</Text>
                <Text style={styles.responseMeta}>{response.comment || "Готов выполнить заказ"}</Text>
              </View>
              <Pressable style={styles.selectResponseButton} onPress={() => run(() => acceptResponse(response))}>
                <Text style={styles.selectResponseButtonText}>✓</Text>
              </Pressable>
            </View>
          ))}
          {responses
            .filter((item) => item.orderId === selectedOrder.id)
            .map((response) => (
              <View key={response.id} style={styles.responseMini}>
                <Text style={styles.responseTitle}>{response.workerName}</Text>
                <Text style={styles.responseMeta}>★ {response.workerRating} · {response.workerEmail}</Text>
                <Text style={styles.responseOrder}>Локальный отклик: {response.createdAt}</Text>
              </View>
            ))}
        </View>

        <View style={styles.inlineActions}>
          {status === "in_progress" && (
            <AppButton title="ЗАВЕРШИТЬ" color="#22c55e" onPress={() => run(() => completeOrder(selectedOrder))} />
          )}
          {status !== "completed" && status !== "cancelled" && (
            <AppButton title="ОТМЕНИТЬ" color="#ef4444" onPress={() => run(() => cancelOrder(selectedOrder))} />
          )}
        </View>
      </View>
    );
  }

  function HistoryScreen() {
    const statuses =
      mode === "worker"
        ? ["", "in_progress", "completed", "cancelled"]
        : ["", "published", "responded", "in_progress", "completed", "cancelled"];

    return (
      <View style={styles.phone}>
        <View style={styles.topBar}>
          <Text style={styles.topTitle}>История</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
          {statuses.map((status) => (
            <SegmentedButton key={status || "all"} active={historyStatus === status} onPress={() => setHistoryStatus(status)}>
              {status ? ORDER_STATUS_LABELS[status] : "Все"}
            </SegmentedButton>
          ))}
        </ScrollView>

        <ScrollView style={styles.ordersList} contentContainerStyle={styles.ordersListContent}>
          {visibleHistory.map((order) => (
            <Pressable
              key={order.id}
              style={styles.orderRow}
              onPress={() => run(() => (mode === "employer" ? openEmployerOrder(order) : openWorkerOrder(order)))}
            >
              <View style={styles.orderStripe} />
              <View style={styles.orderBody}>
                <View style={styles.orderTitleRow}>
                  <Text style={styles.orderTitle}>{order.title}</Text>
                  <StatusBadge status={order.status} />
                </View>
                <Text style={styles.orderMeta}>{order.address}</Text>
              </View>
              <Text style={styles.orderPrice}>{order.price} ₽</Text>
            </Pressable>
          ))}
          {visibleHistory.length === 0 && <Text style={styles.status}>История появится после входа и первых заказов.</Text>}
        </ScrollView>
      </View>
    );
  }

  function ResponsesScreen() {
    return (
      <View style={styles.phone}>
        <View style={styles.topBar}>
          <View>
            <Text style={styles.topTitle}>Отклики</Text>
            <Text style={styles.topMeta}>Новые отклики исполнителей на ваши заказы</Text>
          </View>
          {responses.length > 0 && <Text style={styles.counterBadge}>{responses.length}</Text>}
        </View>

        <ScrollView style={styles.ordersList} contentContainerStyle={styles.ordersListContent}>
          {responses.map((response) => (
            <View key={response.id} style={styles.responseCard}>
              <View style={styles.responseAvatar}>
                <Text style={styles.responseAvatarText}>{response.workerName.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={styles.responseBody}>
                <Text style={styles.responseTitle}>{response.workerName}</Text>
                <Text style={styles.responseMeta}>★ {response.workerRating} · {response.workerEmail}</Text>
                <Text style={styles.responseOrder}>Откликнулся на: {response.orderTitle}</Text>
                <Text style={styles.responseTime}>Сегодня, {response.createdAt}</Text>
                <View style={styles.inlineActions}>
                  <AppButton title="ПРИНЯТЬ" color="#22c55e" onPress={() => setMessage("Исполнитель выбран для заказа")} />
                  <AppButton title="ОТКЛОНИТЬ" color="#ef4444" onPress={() => setResponses((items) => items.filter((item) => item.id !== response.id))} />
                </View>
              </View>
            </View>
          ))}
          {responses.length === 0 && (
            <Text style={styles.status}>
              Пока нет откликов. Когда работник откликнется на заказ, здесь появится карточка исполнителя.
            </Text>
          )}
        </ScrollView>
      </View>
    );
  }

  function ProfileScreen() {
    return (
      <View style={styles.phone}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(name || email).slice(0, 1).toUpperCase()}</Text>
        </View>
        <Text style={styles.profileName}>{name || "Пользователь"}</Text>
        <Text style={styles.status}>{isAuthorized ? email : "Демо-режим без авторизации"}</Text>

        <View style={styles.stats}>
          <View>
            <Text style={styles.statValue}>23</Text>
            <Text style={styles.statLabel}>Заказа</Text>
          </View>
          <View>
            <Text style={styles.statValue}>4.9</Text>
            <Text style={styles.statLabel}>Рейтинг</Text>
          </View>
          <View>
            <Text style={styles.statValue}>{mode === "worker" ? "12" : "8"}</Text>
            <Text style={styles.statLabel}>{mode === "worker" ? "Откликов" : "Исполн."}</Text>
          </View>
        </View>

        {mode === "worker" && (
          <View style={styles.profilePanel}>
            <Text style={styles.sliderLabel}>Максимальная дистанция: {workerRadius} км</Text>
            <Slider minimumValue={1} maximumValue={500} step={1} value={workerRadius} onValueChange={setWorkerRadius} />
          </View>
        )}

        <View style={styles.profilePanel}>
          <Text style={styles.detailLabel}>Разделы после заказа</Text>
          <Text style={styles.detailText}>Чат, транзакции и отзывы заложены в MVP-поток и будут открываться из карточки заказа в работе.</Text>
        </View>

        <AppButton title="СМЕНИТЬ РЕЖИМ" color="#6f82a4" onPress={() => setStep("role")} />
        <AppButton
          title="ВЫЙТИ"
          color="#a9c0f3"
          onPress={() =>
            run(async () => {
              await clearToken();
              setIsAuthorized(false);
              setCurrentUser(null);
              setEmployerOrders([]);
              setEmployerOrderResponses([]);
              setApprovedNoticeIds([]);
              setStep("auth");
            })
          }
        />
      </View>
    );
  }

  function BottomNav() {
    const items =
      mode === "worker"
        ? [
            ["orders", "□\nЗаказы"],
            ["history", "≡\nИстория"],
            ["profile", "○\nПрофиль"],
          ]
        : [
            ["publish", "＋\nОпубликовать"],
            ["employerOrders", `□\nЗаказы${responses.length ? ` ${responses.length}` : ""}`],
            ["history", "≡\nИстория"],
            ["profile", "○\nПрофиль"],
          ];

    return (
      <View style={styles.bottomNav}>
        {items.map(([id, label]) => (
          <Pressable key={id} style={styles.navPressable} onPress={() => setTab(id)}>
            <Text style={[styles.navItem, tab === id && styles.navItemActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    );
  }

  function AppShell() {
    if (selectedOrder) return mode === "employer" ? EmployerOrderScreen() : DetailsScreen();

    return (
      <>
        {tab === "orders" && OrdersScreen()}
        {tab === "publish" && PublishScreen()}
        {tab === "employerOrders" && EmployerOrdersScreen()}
        {tab === "responses" && ResponsesScreen()}
        {tab === "history" && HistoryScreen()}
        {tab === "profile" && ProfileScreen()}
        {BottomNav()}
      </>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={12} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
        {step !== "app" && <Text style={styles.pageTitle}>РАБОТА РЯДОМ ВСЕГДА</Text>}
        {step !== "app" && <View style={styles.titleLine} />}
        {step === "auth" && AuthScreen()}
        {step === "role" && RoleScreen()}
        {step === "location" && LocationScreen()}
        {step === "app" && AppShell()}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#afc7f4", paddingTop: 34 },
  container: { alignItems: "center", padding: 16, paddingBottom: 12, rowGap: 14 },
  pageTitle: { color: "#3278f6", fontSize: 19, fontWeight: "900", letterSpacing: 0, textAlign: "center" },
  titleLine: { backgroundColor: "#3278f6", height: 3, width: 190 },
  authCard: { backgroundColor: "#fff", borderRadius: 6, elevation: 8, maxWidth: 390, padding: 22, rowGap: 12, width: "100%" },
  company: { color: "#4d83e7", fontSize: 16, textAlign: "center" },
  welcome: { color: "#3278f6", fontSize: 18, fontWeight: "900", textAlign: "center" },
  authSwitch: { backgroundColor: "#edf3ff", borderRadius: 10, flexDirection: "row", padding: 4 },
  segment: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  segmentActive: { backgroundColor: "#fff" },
  segmentText: { color: "#60728f", fontSize: 13, fontWeight: "800" },
  segmentTextActive: { color: "#3278f6" },
  input: { backgroundColor: "#fff", borderColor: "#c7d4eb", borderRadius: 8, borderWidth: 1, color: "#172033", fontSize: 14, minHeight: 44, paddingHorizontal: 14 },
  textarea: { minHeight: 92, paddingTop: 12 },
  button: { alignItems: "center", borderRadius: 8, justifyContent: "center", minHeight: 44, overflow: "hidden", paddingHorizontal: 12 },
  buttonPressed: { opacity: 0.72 },
  buttonText: { color: "#fff", fontSize: 13, fontWeight: "900", textAlign: "center" },
  apiHint: { color: "#60728f", fontSize: 11, lineHeight: 16, textAlign: "center" },
  status: { color: "#60728f", fontSize: 13, lineHeight: 19, textAlign: "center" },
  roleCardPurple: { backgroundColor: "#f0e9ff", borderColor: "#8b5cf6", borderRadius: 8, borderWidth: 1, padding: 14, rowGap: 8 },
  roleCardBlue: { backgroundColor: "#e7eef7", borderColor: "#0f2f57", borderRadius: 8, borderWidth: 1, padding: 14, rowGap: 8 },
  roleTitlePurple: { color: "#8b5cf6", fontSize: 18, fontWeight: "900", textAlign: "center" },
  roleTitleBlue: { color: "#0f2f57", fontSize: 18, fontWeight: "900", textAlign: "center" },
  roleText: { color: "#687894", fontSize: 13, textAlign: "center" },
  phone: { backgroundColor: "#fff", borderRadius: 18, maxWidth: 390, minHeight: 600, padding: 14, rowGap: 10, width: "100%" },
  topBar: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  topTitle: { color: "#172033", fontSize: 19, fontWeight: "900" },
  topMeta: { color: "#60728f", fontSize: 12 },
  mapWrap: { backgroundColor: "#eef6f2", borderRadius: 12, height: 150, overflow: "hidden" },
  map: { height: 150, width: "100%" },
  sheetHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  sectionTitle: { color: "#172033", fontSize: 17, fontWeight: "900" },
  filterButton: { alignItems: "center", backgroundColor: "#fff4bf", borderColor: "#f1d96b", borderRadius: 18, borderWidth: 1, height: 36, justifyContent: "center", width: 36 },
  filterButtonText: { color: "#0f2f57", fontSize: 22, fontWeight: "900", lineHeight: 24 },
  filters: { backgroundColor: "#f8fbff", borderRadius: 10, padding: 10, rowGap: 8 },
  categoryRow: { columnGap: 8 },
  sliderLabel: { color: "#536579", fontSize: 13, fontWeight: "800" },
  ordersList: { maxHeight: 310 },
  ordersListContent: { paddingBottom: 12 },
  orderRow: { alignItems: "center", borderBottomColor: "#edf1f5", borderBottomWidth: 1, columnGap: 10, flexDirection: "row", paddingVertical: 10 },
  orderStripe: { backgroundColor: "#8b5cf6", borderRadius: 3, height: 54, width: 4 },
  orderBody: { flex: 1, rowGap: 3 },
  orderTitleRow: { alignItems: "center", columnGap: 6, flexDirection: "row", flexWrap: "wrap" },
  orderTitle: { color: "#172033", fontSize: 14, fontWeight: "900" },
  orderMeta: { color: "#60728f", fontSize: 12 },
  orderDistance: { color: "#8b5cf6", fontSize: 12, fontWeight: "800" },
  orderPrice: { color: "#0f2f57", fontSize: 14, fontWeight: "900" },
  statusBadge: { borderRadius: 12, fontSize: 10, fontWeight: "900", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 3 },
  badgePurple: { backgroundColor: "#f0e9ff", color: "#8b5cf6" },
  badgeCyan: { backgroundColor: "#e0f7ff", color: "#0284c7" },
  badgeYellow: { backgroundColor: "#fef3c7", color: "#a16207" },
  badgeGreen: { backgroundColor: "#dcfce7", color: "#15803d" },
  badgeRed: { backgroundColor: "#fee2e2", color: "#b91c1c" },
  detailHeader: { alignItems: "flex-start", columnGap: 8, flexDirection: "row" },
  backArrow: { color: "#172033", fontSize: 34, fontWeight: "300", lineHeight: 38, paddingRight: 4 },
  detailTitleBlock: { flex: 1, rowGap: 2 },
  detailTitle: { color: "#172033", fontSize: 19, fontWeight: "900" },
  detailPrice: { color: "#0f2f57", fontSize: 20, fontWeight: "900" },
  routePreview: { backgroundColor: "#eef6f2", borderRadius: 14, padding: 14, rowGap: 8 },
  routePointRow: { alignItems: "center", columnGap: 10, flexDirection: "row" },
  routeDotBlue: { backgroundColor: "#3278f6", borderRadius: 7, height: 14, width: 14 },
  routeDotPurple: { backgroundColor: "#8b5cf6", borderRadius: 7, height: 14, width: 14 },
  routeDash: { borderColor: "#9eb5d3", borderStyle: "dashed", borderWidth: 1, height: 22, marginLeft: 6, width: 1 },
  routeTextBlock: { flex: 1 },
  routeSmallLabel: { color: "#0f2f57", fontSize: 11, fontWeight: "900" },
  routeText: { color: "#536579", fontSize: 13, lineHeight: 18 },
  badge: { alignSelf: "flex-start", backgroundColor: "#f0e9ff", borderRadius: 12, color: "#8b5cf6", fontWeight: "900", paddingHorizontal: 10, paddingVertical: 5 },
  compactRow: { alignItems: "center", columnGap: 8, flexDirection: "row" },
  detailTextCompact: { color: "#536579", flex: 1, fontSize: 14, lineHeight: 20 },
  moreButton: { alignItems: "center", backgroundColor: "#fff4bf", borderColor: "#f1d96b", borderRadius: 14, borderWidth: 1, height: 30, justifyContent: "center", width: 36 },
  moreButtonText: { color: "#0f2f57", fontSize: 18, fontWeight: "900" },
  twoColInfo: { columnGap: 10, flexDirection: "row" },
  infoCell: { flex: 1 },
  detailLabel: { color: "#172033", fontSize: 14, fontWeight: "900" },
  detailText: { color: "#536579", fontSize: 14, lineHeight: 20 },
  routeLink: { color: "#3278f6", fontSize: 14, fontWeight: "900", textDecorationLine: "underline" },
  respondRow: { alignItems: "center", columnGap: 10, flexDirection: "row" },
  respondMain: { flex: 1 },
  inlineActions: { columnGap: 8, flexDirection: "row" },
  bookmarkButton: { alignItems: "center", borderColor: "#d5dfe9", borderRadius: 8, borderWidth: 1, height: 44, justifyContent: "center", width: 48 },
  bookmarkButtonActive: { backgroundColor: "#f0e9ff", borderColor: "#8b5cf6" },
  bookmarkText: { color: "#0f2f57", fontSize: 24 },
  overlay: { alignItems: "center", backgroundColor: "rgba(15,47,87,0.28)", bottom: 0, justifyContent: "center", left: 0, position: "absolute", right: 0, top: 0, zIndex: 10 },
  modal: { backgroundColor: "#fff", borderRadius: 12, maxWidth: 320, padding: 16, rowGap: 12, width: "92%" },
  modalTitle: { color: "#172033", fontSize: 18, fontWeight: "900", textAlign: "center" },
  profilePanel: { backgroundColor: "#f8fbff", borderRadius: 10, padding: 12, rowGap: 8 },
  chatPanel: { backgroundColor: "#f8fbff", borderRadius: 12, padding: 12, rowGap: 8 },
  chatBubbleEmployer: { alignSelf: "flex-end", backgroundColor: "#e7eef7", borderRadius: 12, maxWidth: "88%", padding: 10 },
  chatBubbleWorker: { alignSelf: "flex-start", backgroundColor: "#f0e9ff", borderRadius: 12, maxWidth: "88%", padding: 10 },
  chatText: { color: "#536579", fontSize: 13, lineHeight: 18 },
  chatList: { maxHeight: 260, minHeight: 120 },
  chatListContent: { paddingBottom: 8, rowGap: 8 },
  chatInputRow: { alignItems: "center", columnGap: 8, flexDirection: "row" },
  chatInputWrap: { flex: 1 },
  chatSendButton: { alignItems: "center", backgroundColor: "#8b5cf6", borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  chatSendText: { color: "#fff", fontSize: 19, fontWeight: "900" },
  counterBadge: { backgroundColor: "#e0f7ff", borderRadius: 14, color: "#0284c7", fontSize: 13, fontWeight: "900", overflow: "hidden", paddingHorizontal: 10, paddingVertical: 5 },
  responseCard: { alignItems: "flex-start", backgroundColor: "#f8fbff", borderColor: "#e4ebf5", borderRadius: 12, borderWidth: 1, columnGap: 10, flexDirection: "row", marginBottom: 10, padding: 12 },
  responseMini: { alignItems: "center", backgroundColor: "#fff", borderColor: "#e4ebf5", borderRadius: 10, borderWidth: 1, columnGap: 10, flexDirection: "row", padding: 10 },
  responseMiniBody: { flex: 1, rowGap: 4 },
  selectResponseButton: { alignItems: "center", backgroundColor: "#22c55e", borderRadius: 8, height: 42, justifyContent: "center", width: 42 },
  selectResponseButtonText: { color: "#fff", fontSize: 20, fontWeight: "900" },
  responseAvatar: { alignItems: "center", backgroundColor: "#e0f7ff", borderRadius: 24, height: 48, justifyContent: "center", width: 48 },
  responseAvatarText: { color: "#0284c7", fontSize: 18, fontWeight: "900" },
  responseBody: { flex: 1, rowGap: 4 },
  responseTitle: { color: "#172033", fontSize: 15, fontWeight: "900" },
  responseMeta: { color: "#60728f", fontSize: 12 },
  responseOrder: { color: "#0f2f57", fontSize: 13, fontWeight: "800" },
  responseTime: { color: "#8b5cf6", fontSize: 12, fontWeight: "800" },
  bottomNav: { backgroundColor: "#fff", borderTopColor: "#edf1f5", borderTopWidth: 1, flexDirection: "row", justifyContent: "space-around", maxWidth: 390, paddingBottom: 2, paddingHorizontal: 8, paddingTop: 4, width: "100%" },
  navPressable: { flex: 1 },
  navItem: { color: "#6f82a4", fontSize: 10, fontWeight: "800", lineHeight: 14, textAlign: "center" },
  navItemActive: { color: "#3278f6" },
  avatar: { alignItems: "center", alignSelf: "center", backgroundColor: "#e7eef7", borderRadius: 36, height: 72, justifyContent: "center", width: 72 },
  avatarText: { color: "#0f2f57", fontSize: 28, fontWeight: "900" },
  profileName: { color: "#172033", fontSize: 22, fontWeight: "900", textAlign: "center" },
  stats: { flexDirection: "row", justifyContent: "space-around", paddingVertical: 12 },
  statValue: { color: "#172033", fontSize: 18, fontWeight: "900", textAlign: "center" },
  statLabel: { color: "#60728f", fontSize: 12, textAlign: "center" },
});
