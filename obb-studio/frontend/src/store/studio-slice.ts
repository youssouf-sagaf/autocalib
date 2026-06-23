import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ImagerySource, MapViewState, TileSummary } from '../types';

export interface StudioState {
  imagerySource: ImagerySource;
  mapViewState: MapViewState | null;
  tiles: TileSummary[];
  currentTileId: string | null;
}

const initialState: StudioState = {
  imagerySource: 'ign-current',
  mapViewState: { longitude: 2.3522, latitude: 48.8566, zoom: 16 },
  tiles: [],
  currentTileId: null,
};

const studioSlice = createSlice({
  name: 'studio',
  initialState,
  reducers: {
    setImagerySource(state, action: PayloadAction<ImagerySource>) {
      state.imagerySource = action.payload;
    },
    setMapViewState(state, action: PayloadAction<MapViewState>) {
      state.mapViewState = action.payload;
    },
    setTiles(state, action: PayloadAction<TileSummary[]>) {
      state.tiles = action.payload;
    },
    setCurrentTileId(state, action: PayloadAction<string | null>) {
      state.currentTileId = action.payload;
    },
  },
});

export const {
  setImagerySource,
  setMapViewState,
  setTiles,
  setCurrentTileId,
} = studioSlice.actions;
export default studioSlice.reducer;
