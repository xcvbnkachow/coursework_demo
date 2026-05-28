import React from "react";
import { Text, View } from "react-native";

export function MapView({ children, style }) {
  return (
    <View
      style={[
        style,
        {
          alignItems: "center",
          backgroundColor: "#eef6f2",
          justifyContent: "center",
          overflow: "hidden",
        },
      ]}
    >
      <Text style={{ color: "#60728f", fontSize: 13, fontWeight: "800" }}>
        Карта доступна на телефоне
      </Text>
      {children}
    </View>
  );
}

export function Marker() {
  return null;
}

export function Polyline() {
  return null;
}
